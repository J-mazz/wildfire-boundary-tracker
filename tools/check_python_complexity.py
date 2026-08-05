#!/usr/bin/env python3
"""Measure Python function cyclomatic complexity without third-party tooling."""

import ast
import json
import sys
from pathlib import Path

MAXIMUM_COMPLEXITY = 10


class DecisionCounter(ast.NodeVisitor):
    def __init__(self) -> None:
        self.decisions = 0

    def visit_If(self, node: ast.If) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_While(self, node: ast.While) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_IfExp(self, node: ast.IfExp) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        self.decisions += max(0, len(node.values) - 1)
        self.generic_visit(node)

    def visit_comprehension(self, node: ast.comprehension) -> None:
        self.decisions += 1 + len(node.ifs)
        self.generic_visit(node)

    def visit_match_case(self, node: ast.match_case) -> None:
        self.decisions += 1
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return


def function_complexity(node: ast.AST) -> int:
    counter = DecisionCounter()
    for child in ast.iter_child_nodes(node):
        counter.visit(child)
    return 1 + counter.decisions


def functions(path: Path) -> list[dict[str, object]]:
    tree = ast.parse(path.read_text(), filename=str(path))
    measurements = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            measurements.append(
                {
                    "file": str(path),
                    "function": node.name,
                    "cyclomaticComplexity": function_complexity(node),
                }
            )
    return measurements


def main(arguments: list[str]) -> int:
    measurements = [
        measurement
        for argument in arguments
        for measurement in functions(Path(argument))
    ]
    failures = [
        measurement
        for measurement in measurements
        if measurement["cyclomaticComplexity"] > MAXIMUM_COMPLEXITY
    ]
    print(
        json.dumps(
            {
                "maximumComplexity": MAXIMUM_COMPLEXITY,
                "functionsMeasured": len(measurements),
                "maximumObserved": max(
                    (
                        measurement["cyclomaticComplexity"]
                        for measurement in measurements
                    ),
                    default=0,
                ),
                "failures": failures,
            }
        )
    )
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
