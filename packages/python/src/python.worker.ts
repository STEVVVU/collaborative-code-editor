/// <reference lib="webworker" />

import type {
  RawTraceFrame,
  RawTraceStep,
} from "@traceframe/core";
import type {
  PythonWorkerFailure,
  PythonWorkerRequest,
  PythonWorkerSuccess,
} from "./workerProtocol";

declare const self: DedicatedWorkerGlobalScope;

interface PyodideRuntime {
  globals: {
    set(name: string, value: unknown): void;
    delete(name: string): void;
  };
  runPythonAsync(code: string): Promise<unknown>;
}

interface PyodideModule {
  loadPyodide(options: { indexURL: string }): Promise<PyodideRuntime>;
}

const PYODIDE_VERSION = "314.0.3";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`;

const PYTHON_HARNESS = String.raw`
import ast
import bdb
import bisect
import collections
import contextlib
import dis
import functools
import heapq
import io
import inspect
import itertools
import json
import math
import operator
import sys
import time
import tracemalloc
import types
import typing

TRACE_FILENAME = "<traceframe-user-code>"
MAX_DEPTH = 7
MAX_ITEMS = 80
identity_sequence = 0
identity_registry = {}
frame_sequence = 0
frame_registry = {}

class MemoryLimitReached(Exception):
    pass

def type_name(value):
    cls = type(value)
    try:
        module = type.__getattribute__(cls, "__module__")
        qualname = type.__getattribute__(cls, "__qualname__")
    except TypeError:
        module = "unknown"
        qualname = "object"
    return f"{module}.{qualname}" if module != "builtins" else qualname

def class_mro(value_type):
    try:
        return type.__getattribute__(value_type, "__mro__")
    except TypeError:
        return ()

def class_namespace(value_type):
    try:
        return type.__getattribute__(value_type, "__dict__")
    except TypeError:
        return {}

def scalar(value):
    return {"kind": "scalar", "type": type_name(value), "value": value}

def trace_identity(value):
    global identity_sequence
    address = id(value)
    existing = identity_registry.get(address)
    if existing is not None and existing[0] is value:
        return existing[1]
    identity_sequence += 1
    identity = f"py:{identity_sequence}"
    # Retaining the value prevents CPython from reusing its address mid-trace.
    identity_registry[address] = (value, identity)
    return identity

def frame_identity(frame):
    global frame_sequence
    address = id(frame)
    existing = frame_registry.get(address)
    if existing is not None:
        return existing
    frame_sequence += 1
    identity = f"pyframe:{frame_sequence}"
    frame_registry[address] = identity
    return identity

def release_frame_identity(frame):
    frame_registry.pop(id(frame), None)

def stable_member_id(owner_id, value, role):
    if value is None or type(value) in (bool, int, float, str):
        token = json.dumps(
            [type_name(value), value],
            sort_keys=True,
            separators=(",", ":"),
        )
    else:
        token = trace_identity(value)
    return f"{owner_id}:{role}:{token}"

def encode(value, seen, depth=0):
    value_class = type(value)
    if value_class is float and not math.isfinite(value):
        return {
            "kind": "truncated",
            "type": type_name(value),
            "reason": "unsupported",
            "preview": str(value),
        }
    if value is None or value_class in (bool, int, float, str):
        return scalar(value)

    value_type = type_name(value)
    if depth >= MAX_DEPTH:
        return {
            "kind": "truncated",
            "type": value_type,
            "reason": "depth",
            "preview": value_type,
        }

    object_id = trace_identity(value)
    if object_id in seen:
        return {"kind": "reference", "targetId": object_id, "type": value_type}
    seen.add(object_id)

    if value_class in (list, tuple, collections.deque, range):
        items = [
            encode(item, seen, depth + 1)
            for item in itertools.islice(value, MAX_ITEMS)
        ]
        if len(value) > MAX_ITEMS:
            items.append({
                "kind": "truncated",
                "type": value_type,
                "reason": "size",
                "preview": f"{len(value) - MAX_ITEMS} more items",
            })
        return {"kind": "sequence", "id": object_id, "type": value_type, "items": items}

    if isinstance(value, dict):
        entries = []
        entry_ids = []
        for index, (key, item) in enumerate(dict.items(value)):
            if index >= MAX_ITEMS:
                break
            entry_ids.append(stable_member_id(object_id, key, "entry"))
            entries.append([
                encode(key, seen, depth + 1),
                encode(item, seen, depth + 1),
            ])
        return {
            "kind": "mapping",
            "id": object_id,
            "type": value_type,
            "entries": entries,
            "entryIds": entry_ids,
        }

    if isinstance(value, (set, frozenset)):
        items = list(value)
        encoded_items = [
            encode(item, seen, depth + 1)
            for item in items[:MAX_ITEMS]
        ]
        return {
            "kind": "set",
            "id": object_id,
            "type": value_type,
            "items": encoded_items,
            "itemIds": [
                stable_member_id(object_id, item, "member")
                for item in items[:MAX_ITEMS]
            ],
        }

    try:
        instance_fields = object.__getattribute__(value, "__dict__")
    except BaseException:
        instance_fields = None
    field_items = (
        list(instance_fields.items())
        if type(instance_fields) is dict
        else []
    )
    slot_names = []
    for cls in class_mro(type(value)):
        slots = class_namespace(cls).get("__slots__", ())
        if isinstance(slots, str):
            slots = (slots,)
        for name in slots:
            if name in ("__dict__", "__weakref__"):
                continue
            descriptor = class_namespace(cls).get(name)
            if not isinstance(descriptor, types.MemberDescriptorType):
                continue
            slot_names.append((name, descriptor))

    if field_items or slot_names:
        fields = {}
        known_names = {name for name, _ in field_items}
        for name, descriptor in slot_names:
            if name in known_names:
                continue
            try:
                field_items.append((name, descriptor.__get__(value, type(value))))
                known_names.add(name)
            except AttributeError:
                pass
        for index, (name, item) in enumerate(field_items):
            if index >= MAX_ITEMS:
                break
            if type(name) is str and not name.startswith("__"):
                fields[name] = encode(item, seen, depth + 1)
        return {"kind": "object", "id": object_id, "type": value_type, "fields": fields}

    return {
        "kind": "truncated",
        "type": value_type,
        "reason": "unsupported",
        "preview": value_type,
    }

COMPARE_OPERATORS = {
    "Eq": operator.eq,
    "NotEq": operator.ne,
    "Lt": operator.lt,
    "LtE": operator.le,
    "Gt": operator.gt,
    "GtE": operator.ge,
    "Is": operator.is_,
    "IsNot": operator.is_not,
    "In": lambda left, right: left in right,
    "NotIn": lambda left, right: left not in right,
}

BINARY_OPERATORS = {
    "Add": ("add", "arithmetic", operator.add),
    "Sub": ("subtract", "arithmetic", operator.sub),
    "Mult": ("multiply", "arithmetic", operator.mul),
    "Div": ("divide", "arithmetic", operator.truediv),
    "FloorDiv": ("floor-divide", "arithmetic", operator.floordiv),
    "Mod": ("modulo", "arithmetic", operator.mod),
    "Pow": ("power", "arithmetic", operator.pow),
    "LShift": ("shift-left", "bitwise", operator.lshift),
    "RShift": ("shift-right", "bitwise", operator.rshift),
    "BitOr": ("bitwise-or", "bitwise", operator.or_),
    "BitXor": ("bitwise-xor", "bitwise", operator.xor),
    "BitAnd": ("bitwise-and", "bitwise", operator.and_),
    "MatMult": ("matrix-multiply", "arithmetic", operator.matmul),
}

UNARY_OPERATORS = {
    "UAdd": ("positive", "arithmetic", operator.pos),
    "USub": ("negate", "arithmetic", operator.neg),
    "Invert": ("bitwise-not", "bitwise", operator.invert),
}

INPLACE_OPERATORS = {
    "Add": ("add", "arithmetic", operator.iadd),
    "Sub": ("subtract", "arithmetic", operator.isub),
    "Mult": ("multiply", "arithmetic", operator.imul),
    "Div": ("divide", "arithmetic", operator.itruediv),
    "FloorDiv": ("floor-divide", "arithmetic", operator.ifloordiv),
    "Mod": ("modulo", "arithmetic", operator.imod),
    "Pow": ("power", "arithmetic", operator.ipow),
    "LShift": ("shift-left", "bitwise", operator.ilshift),
    "RShift": ("shift-right", "bitwise", operator.irshift),
    "BitOr": ("bitwise-or", "bitwise", operator.ior),
    "BitXor": ("bitwise-xor", "bitwise", operator.ixor),
    "BitAnd": ("bitwise-and", "bitwise", operator.iand),
    "MatMult": ("matrix-multiply", "arithmetic", operator.imatmul),
}

OPERATOR_TOKENS = {
    "Add": "+", "Sub": "-", "Mult": "*", "Div": "/",
    "FloorDiv": "//", "Mod": "%", "Pow": "**", "LShift": "<<",
    "RShift": ">>", "BitOr": "|", "BitXor": "^", "BitAnd": "&",
    "MatMult": "@", "UAdd": "+", "USub": "-", "Invert": "~",
}

def safe_scalar(value):
    return (
        value is None
        or type(value) is bool
        or type(value) is int
        or (type(value) is float and math.isfinite(value))
        or type(value) is str
    )

def encode_safe_scalar(value):
    return {
        "kind": "scalar",
        "type": (
            "null" if value is None
            else "boolean" if type(value) is bool
            else "number" if type(value) is int or type(value) is float
            else "string"
        ),
        "value": value,
    }

class SemanticRuntime:
    def __init__(self):
        self.events_by_frame = {}
        self.call_arguments_by_frame = {}
        self.iterations_by_frame = {}
        self.memo_tables = {}
        self.memo_names = {}

    def _record(self, event):
        frame_id = id(sys._getframe(2))
        self.events_by_frame.setdefault(frame_id, []).append(event)

    def write(self, target, value, line, expression):
        self._record({
            "kind": "write",
            "line": line,
            "expression": expression,
            "target": target,
            "result": value,
        })
        return value

    def read(self, value, line, expression):
        if callable(value):
            return value
        self._record({
            "kind": "read",
            "line": line,
            "expression": expression,
            "result": value,
        })
        return value

    def read_subscript(self, container, key, access_variables, line, expression):
        value = container[key]
        self._record({
            "kind": "read",
            "line": line,
            "expression": expression,
            "result": value,
            "accessVariables": access_variables,
            "accessContainer": container,
            "accessKey": key,
        })
        return value

    def swap(self, target, value, line, expression):
        self._record({
            "kind": "swap",
            "line": line,
            "expression": expression,
            "target": target,
            "result": value,
        })
        return value

    def compare(self, left, right, operator_name, left_expression, right_expression, line, expression):
        result = COMPARE_OPERATORS[operator_name](left, right)
        self._record({
            "kind": "compare",
            "line": line,
            "expression": expression,
            "operator": operator_name,
            "operandExpressions": [left_expression, right_expression],
            "operands": [left, right],
            "result": result,
        })
        return result

    def observe_compare(self, result, line, expression):
        self._record({
            "kind": "compare",
            "line": line,
            "expression": expression,
            "result": result,
        })
        return result

    def binary_operation(
        self,
        left,
        right,
        operator_name,
        left_expression,
        right_expression,
        line,
        expression,
    ):
        semantic_name, category, implementation = BINARY_OPERATORS[operator_name]
        result = implementation(left, right)
        if not (safe_scalar(left) and safe_scalar(right) and safe_scalar(result)):
            return result
        self._record({
            "kind": "operation",
            "line": line,
            "expression": expression,
            "operator": semantic_name,
            "operatorToken": OPERATOR_TOKENS[operator_name],
            "operationCategory": category,
            "operandExpressions": [left_expression, right_expression],
            "operands": [encode_safe_scalar(left), encode_safe_scalar(right)],
            "result": encode_safe_scalar(result),
            "valuesEncoded": True,
        })
        return result

    def unary_operation(
        self,
        operand,
        operator_name,
        operand_expression,
        line,
        expression,
    ):
        semantic_name, category, implementation = UNARY_OPERATORS[operator_name]
        result = implementation(operand)
        if not (safe_scalar(operand) and safe_scalar(result)):
            return result
        self._record({
            "kind": "operation",
            "line": line,
            "expression": expression,
            "operator": semantic_name,
            "operatorToken": OPERATOR_TOKENS[operator_name],
            "operationCategory": category,
            "operandExpressions": [operand_expression],
            "operands": [encode_safe_scalar(operand)],
            "result": encode_safe_scalar(result),
            "valuesEncoded": True,
        })
        return result

    def augmented_operation(
        self,
        left,
        right,
        operator_name,
        target,
        left_expression,
        right_expression,
        line,
        expression,
    ):
        semantic_name, category, implementation = INPLACE_OPERATORS[operator_name]
        result = implementation(left, right)
        if safe_scalar(left) and safe_scalar(right) and safe_scalar(result):
            encoded_result = encode_safe_scalar(result)
            self._record({
                "kind": "operation",
                "line": line,
                "expression": expression,
                "operator": semantic_name,
                "operatorToken": OPERATOR_TOKENS[operator_name],
                "operationCategory": category,
                "operandExpressions": [left_expression, right_expression],
                "operands": [encode_safe_scalar(left), encode_safe_scalar(right)],
                "result": encoded_result,
                "valuesEncoded": True,
            })
        else:
            encoded_result = result
        self._record({
            "kind": "write",
            "line": line,
            "expression": expression,
            "target": target,
            "result": encoded_result,
            **({"valuesEncoded": True} if safe_scalar(result) else {}),
        })
        return result

    def call_argument(self, value, token, line, expression):
        frame_id = id(sys._getframe(1))
        frame_arguments = self.call_arguments_by_frame.setdefault(frame_id, {})
        frame_arguments.setdefault(token, []).append((expression, value))
        return value

    def observe_call(self, result, token, callee, argument_expressions, line, expression):
        frame_id = id(sys._getframe(1))
        frame_arguments = self.call_arguments_by_frame.get(frame_id, {})
        captured = frame_arguments.pop(token, [])
        self._record({
            "kind": "call",
            "line": line,
            "expression": expression,
            "callee": callee,
            "argumentExpressions": argument_expressions,
            "arguments": [value for _, value in captured],
            "result": result,
        })
        return result

    def invoke(
        self,
        callable_value,
        token,
        callee,
        argument_expressions,
        line,
        expression,
        /,
        *arguments,
        **keywords,
    ):
        candidates = []
        receiver = getattr(callable_value, "__self__", None)
        if receiver is not None and not isinstance(receiver, (types.ModuleType, type)):
            candidates.append(receiver)
        candidates.extend(arguments)
        candidates.extend(keywords.values())
        tracked = []
        tracked_ids = set()
        for candidate in candidates:
            if safe_scalar(candidate):
                continue
            identity = id(candidate)
            if identity in tracked_ids:
                continue
            tracked_ids.add(identity)
            tracked.append((candidate, encode(candidate, set())))
        try:
            result = callable_value(*arguments, **keywords)
        except BaseException as error:
            self._record({
                "kind": "call",
                "phase": "throw",
                "line": line,
                "expression": expression,
                "callee": callee,
                "argumentExpressions": argument_expressions,
                "arguments": [*arguments, *keywords.values()],
                "exception": f"{type(error).__name__}: {error}",
                "exceptionId": trace_identity(error),
            })
            raise
        self._record({
            "kind": "call",
            "phase": "end",
            "line": line,
            "expression": expression,
            "callee": callee,
            "argumentExpressions": argument_expressions,
            "arguments": [*arguments, *keywords.values()],
            "result": result,
        })
        for candidate, before in tracked:
            after = encode(candidate, set())
            if before == after:
                continue
            self._record({
                "kind": "mutation",
                "line": line,
                "expression": expression,
                "target": callee,
                "before": before,
                "result": after,
                "accessContainer": after,
                "valuesEncoded": True,
            })
        return result

    def memo_call(
        self,
        callable_value,
        callee,
        argument_expressions,
        line,
        expression,
        /,
        *arguments,
        **keywords,
    ):
        wrapper_type = getattr(functools, "_lru_cache_wrapper", None)
        if wrapper_type is None or type(callable_value) is not wrapper_type:
            return callable_value(*arguments, **keywords)

        identity = id(callable_value)
        table = self.memo_tables.setdefault(identity, {})
        self.memo_names.setdefault(identity, callee)
        before = callable_value.cache_info()
        try:
            result = callable_value(*arguments, **keywords)
        except BaseException as error:
            self._record({
                "kind": "memo",
                "phase": "throw",
                "line": line,
                "expression": expression,
                "callee": callee,
                "cacheHit": False,
                "argumentExpressions": argument_expressions,
                "arguments": [*arguments, *keywords.values()],
                "exception": f"{type(error).__name__}: {error}",
                "exceptionId": trace_identity(error),
            })
            raise
        after = callable_value.cache_info()
        cache_hit = (
            after.misses == before.misses
            and after.hits > before.hits
        )
        safe_arguments = all(safe_scalar(value) for value in arguments)
        safe_keywords = all(
            type(name) is str and safe_scalar(value)
            for name, value in keywords.items()
        )
        if safe_arguments and safe_keywords and safe_scalar(result):
            if len(arguments) == 1 and not keywords:
                key = arguments[0]
            else:
                key = (
                    *arguments,
                    *(
                        ("keyword", name, value)
                        for name, value in sorted(keywords.items())
                    ),
                )
            table[key] = result
        self._record({
            "kind": "memo",
            "line": line,
            "expression": expression,
            "callee": callee,
            "cacheHit": cache_hit,
            "argumentExpressions": argument_expressions,
            "arguments": [*arguments, *keywords.values()],
            "result": result,
        })
        return result

    def memo_bindings(self):
        return [
            (f"{self.memo_names[identity]}.memo", table)
            for identity, table in self.memo_tables.items()
        ]

    def branch(self, value, line, expression):
        result = bool(value)
        self._record({
            "kind": "branch",
            "line": line,
            "expression": expression,
            "result": result,
        })
        return result

    def iterate(self, iterable, target, iterator_expression, access_expressions, line, expression):
        return self.iterate_iterator(
            iter(iterable),
            target,
            iterator_expression,
            access_expressions,
            line,
            expression,
        )

    def make_iterator(self, iterable):
        return iter(iterable)

    def iterate_iterator(self, iterator, target, iterator_expression, access_expressions, line, expression):
        frame_id = None
        token = f"{line}:{target}:{iterator_expression}"
        try:
            position = 0
            while True:
                try:
                    item = next(iterator)
                except StopIteration:
                    break
                frame_id = id(sys._getframe(1))
                active = self.iterations_by_frame.setdefault(frame_id, {})
                active[token] = {
                    "kind": "iteration",
                    "line": line,
                    "expression": expression,
                    "target": target,
                    "iteratorExpression": iterator_expression,
                    "iterationIndex": position,
                    "loopKind": "for",
                    "accessExpressions": access_expressions,
                    "result": item,
                }
                yield item
                position += 1
        finally:
            if frame_id is not None:
                active = self.iterations_by_frame.get(frame_id)
                if active is not None:
                    active.pop(token, None)
                    if not active:
                        self.iterations_by_frame.pop(frame_id, None)

    def while_test(self, value, token, condition, access_expressions, line, expression):
        result = bool(value)
        self._record({
            "kind": "branch",
            "line": line,
            "expression": expression,
            "result": result,
        })
        frame_id = id(sys._getframe(1))
        active = self.iterations_by_frame.setdefault(frame_id, {})
        if result:
            previous = active.get(token)
            active[token] = {
                "kind": "iteration",
                "line": line,
                "expression": expression,
                "target": condition,
                "iteratorExpression": condition,
                "iterationIndex": (
                    previous["iterationIndex"] + 1
                    if previous is not None
                    else 0
                ),
                "loopKind": "while",
                "accessExpressions": access_expressions,
            }
        else:
            active.pop(token, None)
            if not active:
                self.iterations_by_frame.pop(frame_id, None)
        return result

    def clear_iteration(self, token):
        frame_id = id(sys._getframe(1))
        active = self.iterations_by_frame.get(frame_id)
        if active is not None:
            active.pop(token, None)
            if not active:
                self.iterations_by_frame.pop(frame_id, None)

    def drain_frame(self, frame):
        frame_id = id(frame)
        pending = self.events_by_frame.pop(frame_id, [])
        active_iterations = list(
            self.iterations_by_frame.get(frame_id, {}).values()
        )
        self.call_arguments_by_frame.pop(frame_id, None)
        encoded = []
        for event in [*active_iterations, *pending]:
            seen = set()
            item = {
                "kind": event["kind"],
                "source": {"line": event["line"]},
                "expression": event["expression"],
            }
            for key in (
                "target",
                "phase",
                "operator",
                "operatorToken",
                "operationCategory",
                "operandExpressions",
                "callee",
                "cacheHit",
                "argumentExpressions",
                "iteratorExpression",
                "iterationIndex",
                "loopKind",
                "accessExpressions",
                "accessVariables",
                "exception",
                "exceptionId",
            ):
                if key in event:
                    item[key] = event[key]
            if "operands" in event:
                item["operands"] = (
                    event["operands"]
                    if event.get("valuesEncoded")
                    else [encode(value, seen) for value in event["operands"]]
                )
            if "result" in event:
                item["result"] = (
                    event["result"]
                    if event.get("valuesEncoded")
                    else encode(event["result"], seen)
                )
            if "before" in event:
                item["before"] = (
                    event["before"]
                    if event.get("valuesEncoded")
                    else encode(event["before"], seen)
                )
            if "arguments" in event:
                item["arguments"] = [
                    encode(value, seen) for value in event["arguments"]
                ]
            if "accessContainer" in event:
                item["accessContainer"] = (
                    event["accessContainer"]
                    if event.get("valuesEncoded")
                    else encode(event["accessContainer"], seen)
                )
            if "accessKey" in event:
                item["accessKey"] = encode(event["accessKey"], seen)
            encoded.append(item)
        return encoded

    def clear(self):
        self.events_by_frame.clear()
        self.call_arguments_by_frame.clear()
        self.iterations_by_frame.clear()
        self.memo_tables.clear()
        self.memo_names.clear()

class Instrumenter(ast.NodeTransformer):
    def __init__(self, source):
        self.source = source
        self.memoized_function_names = set()

    def cache_decorator(self, decorator):
        candidate = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(candidate, ast.Name):
            return candidate.id in ("cache", "lru_cache")
        if isinstance(candidate, ast.Attribute):
            return candidate.attr in ("cache", "lru_cache")
        return False

    def visit_Module(self, node):
        self.memoized_function_names = {
            candidate.name
            for candidate in ast.walk(node)
            if isinstance(candidate, (ast.FunctionDef, ast.AsyncFunctionDef))
            and any(
                self.cache_decorator(decorator)
                for decorator in candidate.decorator_list
            )
        }
        return self.generic_visit(node)

    def text(self, node):
        return ast.get_source_segment(self.source, node) or type(node).__name__

    def runtime_call(self, method, arguments, node, expression=None):
        call = ast.Call(
            func=ast.Attribute(
                value=ast.Name(id="__tf__", ctx=ast.Load()),
                attr=method,
                ctx=ast.Load(),
            ),
            args=[
                *arguments,
                ast.Constant(value=getattr(node, "lineno", 0)),
                ast.Constant(value=expression or self.text(node)),
            ],
            keywords=[],
        )
        return ast.copy_location(call, node)

    def access_expressions(self, statements):
        expressions = []
        instrumenter = self

        class AccessCollector(ast.NodeVisitor):
            def visit_Subscript(self, candidate):
                expressions.append(instrumenter.text(candidate))
                self.generic_visit(candidate)

            def visit_FunctionDef(self, candidate):
                return

            def visit_AsyncFunctionDef(self, candidate):
                return

            def visit_Lambda(self, candidate):
                return

            def visit_ClassDef(self, candidate):
                return

        collector = AccessCollector()
        for statement in statements:
            collector.visit(statement)
        return list(dict.fromkeys(expressions))

    def visit_Compare(self, node):
        expression = self.text(node)
        left_expression = self.text(node.left)
        right_expressions = [self.text(item) for item in node.comparators]
        node = self.generic_visit(node)
        if len(node.ops) == 1 and len(node.comparators) == 1:
            operator_name = type(node.ops[0]).__name__
            if operator_name in COMPARE_OPERATORS:
                return self.runtime_call(
                    "compare",
                    [
                        node.left,
                        node.comparators[0],
                        ast.Constant(value=operator_name),
                        ast.Constant(value=left_expression),
                        ast.Constant(value=right_expressions[0]),
                    ],
                    node,
                    expression,
                )
        return self.runtime_call("observe_compare", [node], node, expression)

    def visit_BinOp(self, node):
        expression = self.text(node)
        left_expression = self.text(node.left)
        right_expression = self.text(node.right)
        operator_name = type(node.op).__name__
        node = self.generic_visit(node)
        if operator_name not in BINARY_OPERATORS:
            return node
        return self.runtime_call(
            "binary_operation",
            [
                node.left,
                node.right,
                ast.Constant(value=operator_name),
                ast.Constant(value=left_expression),
                ast.Constant(value=right_expression),
            ],
            node,
            expression,
        )

    def visit_UnaryOp(self, node):
        expression = self.text(node)
        operand_expression = self.text(node.operand)
        operator_name = type(node.op).__name__
        node = self.generic_visit(node)
        if operator_name not in UNARY_OPERATORS:
            return node
        return self.runtime_call(
            "unary_operation",
            [
                node.operand,
                ast.Constant(value=operator_name),
                ast.Constant(value=operand_expression),
            ],
            node,
            expression,
        )

    def visit_BoolOp(self, node):
        return self.generic_visit(node)

    def visit_Subscript(self, node):
        expression = self.text(node)
        access_variables = sorted({
            candidate.id
            for candidate in ast.walk(node.slice)
            if isinstance(candidate, ast.Name)
            and isinstance(candidate.ctx, ast.Load)
        })
        node = self.generic_visit(node)
        if isinstance(node.ctx, ast.Load):
            if not isinstance(node.slice, ast.Slice):
                return self.runtime_call(
                    "read_subscript",
                    [
                        node.value,
                        node.slice,
                        ast.List(
                            elts=[
                                ast.Constant(value=value)
                                for value in access_variables
                            ],
                            ctx=ast.Load(),
                        ),
                    ],
                    node,
                    expression,
                )
            return node
        return node

    def visit_Attribute(self, node):
        expression = self.text(node)
        node = self.generic_visit(node)
        if isinstance(node.ctx, ast.Load):
            return self.runtime_call("read", [node], node, expression)
        return node

    def visit_Call(self, node):
        if (
            isinstance(node.func, ast.Name)
            and node.func.id == "super"
            and not node.args
            and not node.keywords
        ):
            return node
        if (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Call)
            and isinstance(node.func.value.func, ast.Name)
            and node.func.value.func.id == "super"
            and not node.func.value.args
            and not node.func.value.keywords
        ):
            return node
        expression = self.text(node)
        callee = self.text(node.func)
        token = (
            f"call:{getattr(node, 'lineno', 0)}:"
            f"{getattr(node, 'col_offset', 0)}"
        )
        argument_expressions = [
            self.text(argument)
            for argument in node.args
        ] + [
            (
                f"{keyword.arg}={self.text(keyword.value)}"
                if keyword.arg is not None
                else f"**{self.text(keyword.value)}"
            )
            for keyword in node.keywords
        ]
        is_memoized_call = (
            isinstance(node.func, ast.Name)
            and node.func.id in self.memoized_function_names
        ) or (
            isinstance(node.func, ast.Attribute)
            and node.func.attr in self.memoized_function_names
        )
        node = self.generic_visit(node)
        if is_memoized_call:
            return ast.copy_location(
                ast.Call(
                    func=ast.Attribute(
                        value=ast.Name(id="__tf__", ctx=ast.Load()),
                        attr="memo_call",
                        ctx=ast.Load(),
                    ),
                    args=[
                        node.func,
                        ast.Constant(value=callee),
                        ast.List(
                            elts=[
                                ast.Constant(value=value)
                                for value in argument_expressions
                            ],
                            ctx=ast.Load(),
                        ),
                        ast.Constant(value=getattr(node, "lineno", 0)),
                        ast.Constant(value=expression),
                        *node.args,
                    ],
                    keywords=node.keywords,
                ),
                node,
            )

        return ast.copy_location(
            ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="__tf__", ctx=ast.Load()),
                    attr="invoke",
                    ctx=ast.Load(),
                ),
                args=[
                    node.func,
                    ast.Constant(value=token),
                    ast.Constant(value=callee),
                    ast.List(
                        elts=[
                            ast.Constant(value=value)
                            for value in argument_expressions
                        ],
                        ctx=ast.Load(),
                    ),
                    ast.Constant(value=getattr(node, "lineno", 0)),
                    ast.Constant(value=expression),
                    *node.args,
                ],
                keywords=node.keywords,
            ),
            node,
        )

    def visit_Assign(self, node):
        expression = self.text(node)
        target = " = ".join(self.text(item) for item in node.targets)
        is_swap = False
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Tuple) and isinstance(node.value, ast.Tuple):
            left = node.targets[0].elts
            right = node.value.elts
            is_swap = (
                len(left) == 2
                and len(right) == 2
                and self.text(left[0]).strip() == self.text(right[1]).strip()
                and self.text(left[1]).strip() == self.text(right[0]).strip()
            )
        node = self.generic_visit(node)
        node.value = self.runtime_call(
            "swap" if is_swap else "write",
            [ast.Constant(value=target), node.value],
            node,
            expression,
        )
        return node

    def visit_AnnAssign(self, node):
        if node.value is None:
            return self.generic_visit(node)
        expression = self.text(node)
        target = self.text(node.target)
        node = self.generic_visit(node)
        node.value = self.runtime_call(
            "write",
            [ast.Constant(value=target), node.value],
            node,
            expression,
        )
        return node

    def visit_AugAssign(self, node):
        expression = self.text(node)
        target = self.text(node.target)
        right_expression = self.text(node.value)
        operator_name = type(node.op).__name__
        if operator_name not in INPLACE_OPERATORS:
            return self.generic_visit(node)

        if isinstance(node.target, ast.Name):
            load_target = ast.Name(id=node.target.id, ctx=ast.Load())
            store_target = ast.Name(id=node.target.id, ctx=ast.Store())
        else:
            return self.generic_visit(node)

        value = self.visit(node.value)
        assignment = ast.Assign(
            targets=[store_target],
            value=self.runtime_call(
                "augmented_operation",
                [
                    load_target,
                    value,
                    ast.Constant(value=operator_name),
                    ast.Constant(value=target),
                    ast.Constant(value=target),
                    ast.Constant(value=right_expression),
                ],
                node,
                expression,
            ),
        )
        return ast.copy_location(assignment, node)

    def visit_NamedExpr(self, node):
        expression = self.text(node)
        target = self.text(node.target)
        node = self.generic_visit(node)
        node.value = self.runtime_call(
            "write",
            [ast.Constant(value=target), node.value],
            node,
            expression,
        )
        return node

    def visit_If(self, node):
        expression = self.text(node.test)
        node = self.generic_visit(node)
        node.test = self.runtime_call("branch", [node.test], node.test, expression)
        return node

    def visit_While(self, node):
        expression = self.text(node.test)
        access_expressions = self.access_expressions([node.test, *node.body])
        token = (
            f"while:{getattr(node, 'lineno', 0)}:"
            f"{getattr(node, 'col_offset', 0)}"
        )
        node = self.generic_visit(node)
        node.test = self.runtime_call(
            "while_test",
            [
                node.test,
                ast.Constant(value=token),
                ast.Constant(value=expression),
                ast.List(
                    elts=[
                        ast.Constant(value=value)
                        for value in access_expressions
                    ],
                    ctx=ast.Load(),
                ),
            ],
            node.test,
            expression,
        )
        cleanup = ast.Expr(
            value=ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="__tf__", ctx=ast.Load()),
                    attr="clear_iteration",
                    ctx=ast.Load(),
                ),
                args=[ast.Constant(value=token)],
                keywords=[],
            )
        )
        return [node, ast.copy_location(cleanup, node)]

    def visit_IfExp(self, node):
        expression = self.text(node.test)
        node = self.generic_visit(node)
        node.test = self.runtime_call("branch", [node.test], node.test, expression)
        return node

    def visit_For(self, node):
        expression = self.text(node)
        target = self.text(node.target)
        iterator_expression = self.text(node.iter)
        access_expressions = self.access_expressions(node.body)
        node = self.generic_visit(node)
        node.iter = self.runtime_call(
            "iterate",
            [
                node.iter,
                ast.Constant(value=target),
                ast.Constant(value=iterator_expression),
                ast.List(
                    elts=[
                        ast.Constant(value=value)
                        for value in access_expressions
                    ],
                    ctx=ast.Load(),
                ),
            ],
            node.iter,
            expression,
        )
        return node

    def visit_comprehension(self, node):
        if node.is_async:
            return self.generic_visit(node)
        expression = self.text(node)
        target = self.text(node.target)
        iterator_expression = self.text(node.iter)
        node = self.generic_visit(node)
        iterator = ast.Call(
            func=ast.Attribute(
                value=ast.Name(id="__tf__", ctx=ast.Load()),
                attr="make_iterator",
                ctx=ast.Load(),
            ),
            args=[node.iter],
            keywords=[],
        )
        node.iter = self.runtime_call(
            "iterate_iterator",
            [
                iterator,
                ast.Constant(value=target),
                ast.Constant(value=iterator_expression),
                ast.List(elts=[], ctx=ast.Load()),
            ],
            node.iter,
            expression,
        )
        return node

semantic_runtime = SemanticRuntime()

def bound_receiver(frame):
    if frame.f_code.co_argcount < 1:
        return None
    name = frame.f_code.co_varnames[0]
    if name not in frame.f_locals:
        return None
    value = frame.f_locals[name]
    owner_type = value if isinstance(value, type) else type(value)
    for cls in class_mro(owner_type):
        for descriptor in class_namespace(cls).values():
            if isinstance(descriptor, staticmethod):
                continue
            target = (
                descriptor.__func__
                if isinstance(descriptor, classmethod)
                else descriptor
            )
            if getattr(target, "__code__", None) is frame.f_code:
                return name, value
    return None

def visible_receiver_fields(value, seen):
    fields = {}
    if not isinstance(value, type):
        encoded = encode(value, seen)
        if encoded["kind"] == "object":
            fields.update(encoded["fields"])
    owner_type = value if isinstance(value, type) else type(value)
    for cls in class_mro(owner_type):
        if type.__getattribute__(cls, "__module__") != "__main__":
            continue
        for name, descriptor in class_namespace(cls).items():
            if name.startswith("__"):
                continue
            if (
                isinstance(descriptor, (staticmethod, classmethod, property))
                or callable(descriptor)
            ):
                continue
            if name not in fields:
                fields[name] = encode(descriptor, seen)
    return fields

def visible_locals(frame, include_receiver_fields=False):
    seen = set()
    result = {}
    persistent_bindings = []
    receiver = bound_receiver(frame)
    receiver_name = receiver[0] if receiver else None
    receiver_value = receiver[1] if receiver else None
    for name, value in frame.f_locals.items():
        if name.startswith("__"):
            continue
        if (
            name in implicit_bindings
            and value is implicit_bindings[name]
        ):
            continue
        if name == receiver_name:
            if include_receiver_fields:
                fields = visible_receiver_fields(receiver_value, seen)
                for field_name, field_value in fields.items():
                    binding_name = f"{receiver_name}.{field_name}"
                    result[binding_name] = field_value
                    persistent_bindings.append(binding_name)
            continue
        if isinstance(value, (types.ModuleType, type)) or callable(value):
            continue
        result[name] = encode(value, seen)
    for binding_name, table in semantic_runtime.memo_bindings():
        result[binding_name] = encode(table, seen)
        persistent_bindings.append(binding_name)
    return result, persistent_bindings

def resolve_user_symbol(path, namespace):
    parts = path.split(".")
    value = namespace.get(parts[0])
    for attribute in parts[1:]:
        value = getattr(value, attribute, None)
    if value is None:
        raise NameError(f"Input type or callable '{path}' was not found")
    return value

def collect_input_identities(value, namespace, identities):
    if isinstance(value, list):
        for item in value:
            collect_input_identities(item, namespace, identities)
        return
    if not isinstance(value, dict):
        return

    kind = value.get("$kind")
    identity = value.get("id")
    if kind == "object" and identity:
        if identity in identities:
            raise ValueError(f"Duplicate input identity '{identity}'")
        value_type = resolve_user_symbol(value["type"], namespace)
        identities[identity] = value_type.__new__(value_type)

    children = []
    if kind == "object":
        children = value.get("fields", {}).values()
    elif kind == "construct":
        children = [
            *value.get("arguments", []),
            *value.get("keywordArguments", {}).values(),
            *value.get("fields", {}).values(),
        ]
    elif kind != "reference":
        children = value.values()
    for child in children:
        collect_input_identities(child, namespace, identities)

def materialize_input(value, namespace, identities):
    if isinstance(value, list):
        return [materialize_input(item, namespace, identities) for item in value]
    if not isinstance(value, dict):
        return value

    kind = value.get("$kind")
    if kind == "reference":
        identity = value.get("id")
        if identity not in identities:
            raise ValueError(f"Unknown input reference '{identity}'")
        return identities[identity]

    if kind == "object":
        value_type = resolve_user_symbol(value["type"], namespace)
        identity = value.get("id")
        instance = identities.get(identity) if identity else value_type.__new__(value_type)
        for name, item in value.get("fields", {}).items():
            setattr(instance, name, materialize_input(item, namespace, identities))
        return instance

    if kind == "construct":
        constructor = resolve_user_symbol(value["callable"], namespace)
        arguments = [
            materialize_input(item, namespace, identities)
            for item in value.get("arguments", [])
        ]
        keyword_arguments = {
            name: materialize_input(item, namespace, identities)
            for name, item in value.get("keywordArguments", {}).items()
        }
        instance = constructor(*arguments, **keyword_arguments)
        for name, item in value.get("fields", {}).items():
            setattr(instance, name, materialize_input(item, namespace, identities))
        return instance

    return {
        key: materialize_input(item, namespace, identities)
        for key, item in value.items()
    }

frames = []
steps = []
stream = io.StringIO()
started = time.perf_counter()
execution_error = None
trace_enabled = bool(__trace_enabled)
frame_budget = max(1, int(__trace_max_frames))
events_observed = 0
sampling_stride = 1
ordinary_frames_retained = 0
required_event_indices = set()
memory_limit_bytes = int(__trace_max_memory_bytes)
tracemalloc.start()
memory_baseline_bytes = tracemalloc.get_traced_memory()[0]

def enforce_memory_limit():
    current_bytes = tracemalloc.get_traced_memory()[0]
    used_bytes = max(0, current_bytes - memory_baseline_bytes)
    if used_bytes > memory_limit_bytes:
        limit_mb = memory_limit_bytes / (1024 * 1024)
        used_mb = used_bytes / (1024 * 1024)
        raise MemoryLimitReached(
            f"Execution exceeded the {limit_mb:g} MB memory limit "
            f"({used_mb:.1f} MB used)"
        )

class RecordingDebugger(bdb.Bdb):
    def __init__(self):
        super().__init__(backend="settrace")
        self.suspended_frames = set()
        self.seen_exceptions = set()

    def stop_here(self, frame):
        return frame.f_code.co_filename == TRACE_FILENAME

    def user_frames(self, frame):
        stack, _ = self.get_stack(frame, None)
        return [
            (item, line)
            for item, line in stack
            if item.f_code.co_filename == TRACE_FILENAME
        ]

    def parameter_names(self, frame):
        arguments = inspect.getargvalues(frame)
        return [
            *arguments.args,
            *([arguments.varargs] if arguments.varargs else []),
            *([arguments.keywords] if arguments.keywords else []),
        ]

    def is_suspension(self, frame):
        if not (
            frame.f_code.co_flags
            & (
                inspect.CO_GENERATOR
                | inspect.CO_COROUTINE
                | inspect.CO_ASYNC_GENERATOR
            )
        ):
            return False
        return any(
            instruction.offset == frame.f_lasti
            and instruction.opname in ("YIELD_VALUE", "YIELD_FROM")
            for instruction in dis.get_instructions(frame.f_code)
        )

    def record(self, frame, event, arg=None):
        global events_observed, sampling_stride, ordinary_frames_retained
        if frame.f_code.co_filename != TRACE_FILENAME:
            return
        enforce_memory_limit()
        if not trace_enabled:
            return

        event_number = events_observed
        events_observed += 1
        user_frames = self.user_frames(frame)
        stack = [
            {
                "functionName": item.f_code.co_name,
                "scopeId": frame_identity(item),
                "line": max(1, line),
                "parameters": self.parameter_names(item),
            }
            for item, line in user_frames
        ]
        depth = max(0, len(user_frames) - 1)
        semantic_events = semantic_runtime.drain_frame(frame)
        exception_id = None
        if event == "exception" and arg:
            exception_id = trace_identity(arg[1])
            exception_phase = (
                "propagate"
                if exception_id in self.seen_exceptions
                else "throw"
            )
            self.seen_exceptions.add(exception_id)
            semantic_events.append({
                "kind": "exception",
                "phase": exception_phase,
                "source": {"line": max(1, frame.f_lineno)},
                "expression": f"{type(arg[1]).__name__}: {arg[1]}",
                "exception": f"{type(arg[1]).__name__}: {arg[1]}",
                "exceptionId": exception_id,
            })
        steps.append({
            "event": event,
            "source": {"line": max(1, frame.f_lineno)},
            "functionName": frame.f_code.co_name,
            "scopeId": frame_identity(frame),
            "depth": depth,
            "callStack": stack,
            "semanticEvents": semantic_events,
        })
        required_snapshot = (
            event == "call"
            or event == "resume"
            or event == "yield"
            or event == "exception"
            or (event == "return" and depth == 0)
        )
        capture = (
            event_number % sampling_stride == 0
            or required_snapshot
        )
        if not capture:
            return

        exception = None
        if event == "exception" and arg:
            exception = f"{type(arg[1]).__name__}: {arg[1]}"
        return_value = encode(arg, set()) if event == "return" else None
        yield_value = encode(arg, set()) if event == "yield" else None
        frame_locals, persistent_bindings = visible_locals(frame, depth == 0)
        frames.append({
            "eventIndex": event_number,
            "event": event,
            "source": {"line": max(1, frame.f_lineno)},
            "functionName": frame.f_code.co_name,
            "scopeId": frame_identity(frame),
            "depth": depth,
            "callStack": stack,
            "ancestorScopes": [
                {
                    "functionName": item.f_code.co_name,
                    "scopeId": frame_identity(item),
                    "line": max(1, line),
                    "parameters": self.parameter_names(item),
                    "locals": visible_locals(item)[0],
                }
                for item, line in user_frames[:-1]
            ],
            "locals": frame_locals,
            "persistentBindings": persistent_bindings,
            "stdout": stream.getvalue(),
            "semanticEvents": semantic_events,
            **({"returnValue": return_value} if event == "return" else {}),
            **({"yieldValue": yield_value} if event == "yield" else {}),
            **({"exception": exception} if exception else {}),
            **({"exceptionId": exception_id} if exception_id else {}),
        })
        if required_snapshot:
            required_event_indices.add(event_number)
        else:
            ordinary_frames_retained += 1
        if ordinary_frames_retained > frame_budget:
            ordinary_index = 0
            compacted = []
            for retained_frame in frames:
                if retained_frame["eventIndex"] in required_event_indices:
                    compacted.append(retained_frame)
                    continue
                if ordinary_index % 2 == 0:
                    compacted.append(retained_frame)
                ordinary_index += 1
            frames[:] = compacted
            ordinary_frames_retained = (ordinary_frames_retained + 1) // 2
            sampling_stride *= 2

    def user_call(self, frame, argument_list):
        frame_id = id(frame)
        if frame_id in self.suspended_frames:
            self.suspended_frames.remove(frame_id)
            self.record(frame, "resume", argument_list)
        else:
            self.record(frame, "call", argument_list)

    def user_line(self, frame):
        self.record(frame, "line")

    def user_return(self, frame, return_value):
        if self.is_suspension(frame):
            self.suspended_frames.add(id(frame))
            self.record(frame, "yield", return_value)
        else:
            self.suspended_frames.discard(id(frame))
            self.record(frame, "return", return_value)
            release_frame_identity(frame)

    def user_exception(self, frame, exception_info):
        self.record(frame, "exception", exception_info)

debugger = RecordingDebugger()

def install_prelude(target, modules):
    installed = {}
    for module in modules:
        exported_names = getattr(module, "__all__", None)
        names = exported_names if exported_names is not None else vars(module)
        for name in names:
            if name.startswith("_"):
                continue
            if name not in target:
                value = getattr(module, name)
                target[name] = value
                installed[name] = value
    return installed

namespace = {
    "__name__": "__main__",
    "__tf__": semantic_runtime,
}
implicit_bindings = install_prelude(namespace, (
    collections,
    itertools,
    functools,
    heapq,
    bisect,
    math,
    typing,
))
try:
    invocation = json.loads(__trace_run_spec)
    syntax_tree = ast.parse(__trace_source, filename=TRACE_FILENAME, mode="exec")
    if trace_enabled:
        syntax_tree = Instrumenter(__trace_source).visit(syntax_tree)
    ast.fix_missing_locations(syntax_tree)
    compiled = compile(syntax_tree, TRACE_FILENAME, "exec")
    with contextlib.redirect_stdout(stream):
        if invocation["mode"] == "script":
            debugger.runcall(lambda: exec(compiled, namespace, namespace))
        else:
            exec(compiled, namespace, namespace)
        if invocation["mode"] == "function":
            semantic_runtime.clear()
            entrypoint_name = invocation["entrypoint"]
            entrypoint_parts = entrypoint_name.split(".")
            entrypoint = namespace.get(entrypoint_parts[0])
            if isinstance(entrypoint, type) and len(entrypoint_parts) > 1:
                entrypoint = entrypoint()
            for attribute in entrypoint_parts[1:]:
                entrypoint = getattr(entrypoint, attribute, None)
            if not callable(entrypoint) and len(entrypoint_parts) == 1:
                solution_type = namespace.get("Solution")
                if isinstance(solution_type, type):
                    entrypoint = getattr(solution_type(), entrypoint_name, None)
            if not callable(entrypoint):
                raise NameError(f"Callable '{entrypoint_name}' was not found")
            raw_arguments = invocation.get("arguments", [])
            input_identities = {}
            collect_input_identities(raw_arguments, namespace, input_identities)
            arguments = [
                materialize_input(item, namespace, input_identities)
                for item in raw_arguments
            ]
            semantic_runtime.clear()
            debugger.runcall(lambda: entrypoint(*arguments))
except MemoryLimitReached as error:
    execution_error = str(error)
except BaseException as error:
    execution_error = f"{type(error).__name__}: {error}"
finally:
    debugger.stop_trace()
    tracemalloc.stop()

json.dumps({
    "frames": frames,
    "steps": steps,
    "stdout": stream.getvalue(),
    "durationMs": (time.perf_counter() - started) * 1000,
    "eventsObserved": events_observed,
    "samplingStride": sampling_stride,
    **({"error": execution_error} if execution_error else {}),
})
`;

let runtimePromise: Promise<PyodideRuntime> | undefined;

interface WorkerTrace {
  frames: RawTraceFrame[];
  steps: RawTraceStep[];
  stdout: string;
  durationMs: number;
  eventsObserved: number;
  samplingStride: number;
  error?: string;
}

async function runHarness(
  runtime: PyodideRuntime,
  traceEnabled: boolean,
): Promise<WorkerTrace> {
  runtime.globals.set("__trace_enabled", traceEnabled);
  const rawResult = await runtime.runPythonAsync(PYTHON_HARNESS);
  return JSON.parse(String(rawResult)) as WorkerTrace;
}

async function getRuntime(): Promise<PyodideRuntime> {
  if (!runtimePromise) {
    self.postMessage({ type: "status", status: "loading" });
    runtimePromise = import(/* @vite-ignore */ PYODIDE_MODULE_URL)
      .then((module) =>
        (module as PyodideModule).loadPyodide({
          indexURL: PYODIDE_INDEX_URL,
        }),
      )
      .then((runtime) => {
        self.postMessage({ type: "status", status: "ready" });
        return runtime;
      });
  }
  return runtimePromise;
}

self.addEventListener("message", async (event: MessageEvent<PythonWorkerRequest>) => {
  const request = event.data;
  try {
    const runtime = await getRuntime();
    runtime.globals.set("__trace_source", request.source);
    runtime.globals.set("__trace_run_spec", JSON.stringify(request.runSpec));
    runtime.globals.set("__trace_max_frames", request.snapshotBudget);
    runtime.globals.set("__trace_max_memory_bytes", request.maxMemoryBytes);
    self.postMessage({
      type: "phase",
      id: request.id,
      phase: "tracing",
    });
    const trace = await runHarness(runtime, true);
    runtime.globals.delete("__trace_source");
    runtime.globals.delete("__trace_run_spec");
    runtime.globals.delete("__trace_max_frames");
    runtime.globals.delete("__trace_max_memory_bytes");
    runtime.globals.delete("__trace_enabled");
    const response: PythonWorkerSuccess = { id: request.id, ok: true, trace };
    self.postMessage(response);
  } catch (error) {
    const response: PythonWorkerFailure = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
});

export {};
