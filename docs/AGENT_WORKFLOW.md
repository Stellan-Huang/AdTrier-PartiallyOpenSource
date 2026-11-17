# Agent-Assisted Development Workflow

## 1. Spec-first development

The project uses architecture PRDs, Rules, and explicit technical
boundaries to define work before implementation. The goal is to make
requirements and constraints inspectable rather than relying on informal
prompts alone.

A typical task follows this sequence:

1.  Define the intended behavior and acceptance criteria.
2.  Record relevant architecture and implementation constraints.
3.  Break the work into bounded tasks.
4.  Use development agents and tools to implement the tasks.
5.  Run automated checks and review the resulting changes.
6.  Have a human confirm, revise, or request rework before delivery.

## 2. Development tools

MCP, CLI tools, and Skills are used to coordinate development agents and
connect them to the required tools and workflows. A Test Agent supports
automated review and test execution.

The workflow combines automation with human confirmation. Agent output
is treated as a proposal that must satisfy the project's specifications
and tests.

## 3. Important architectural distinction

This document describes how the software was developed.

It does **not** claim that the customer-facing AdTrier product contains
a general-purpose autonomous Agent runtime, or that MCP is part of the
production ad-generation pipeline. The production pipeline is documented
separately as a staged workflow of product understanding, creative
planning, media generation, composition, and QA.

## 4. Why this matters

A specification-first workflow helps keep implementation aligned with
architecture and product constraints. Automated review improves
iteration speed, while human confirmation provides a final decision
point for correctness, scope, and quality.
