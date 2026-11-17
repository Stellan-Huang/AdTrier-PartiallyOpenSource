# Project Overview

## 1. Product

AdTrier is an early-access AI advertising-video product for cross-border
e-commerce sellers.

Its product promise is deliberately simple:

> Give us your product. We'll make the ad.

A seller provides basic product information and available assets.
AdTrier then coordinates product understanding, creative development,
script writing, visual generation, audio production, and video
composition to deliver a short-form advertisement.

The live product and landing-page demo are available at
[adtrier.com](https://adtrier.com).

## 2. Problem and product principles

The product targets a recurring production bottleneck for smaller
sellers: creating usable advertising videos often requires several
tools, editing skills, repeated prompt tuning, and substantial manual
coordination.

AdTrier is built around three product principles:

1.  **Reduce user effort.** Ask for essential product information rather
    than exposing a complex editing interface.
2.  **Automate the production path.** Coordinate creative and media
    stages behind a small number of user-facing actions.
3.  **Keep the economics flexible.** Use credits for on-demand work
    rather than requiring a recurring subscription.

## 3. User-facing workflow

At a high level, the product follows this path:

1.  The user supplies product information and optional assets.
2.  The system extracts and normalizes the available information.
3.  Product Intelligence builds a structured understanding of the
    product.
4.  Creative Planning proposes and selects an advertising direction.
5.  Script Expansion turns the selected direction into a scene-oriented
    script.
6.  The generation pipeline creates scene media and audio, then composes
    the video.
7.  Quality checks inspect the result before delivery.

The landing page presents the live product experience. The research
repository focuses on the underlying engine and its engineering
boundaries.

## 4. Commercial model in the production product

The commercial design is part of the product's low-friction positioning:

-   Welcome credits provide a first-use entry point.
-   Credit packs support occasional use without a monthly subscription.
-   A watermarked preview reduces the risk of paying before seeing the
    result.
-   The final deliverable can be unlocked after preview.
-   Creem handles payment checkout.
-   Resend supports OTP verification and result delivery.
-   Failed-generation handling follows a refund policy.

These are production-product capabilities and context. They are not the
primary scope of the Research Edition.

## 5. Research focus

The project is worth studying as an example of a constrained,
multi-stage generative system rather than a single prompt sent to one
model.

The key engineering questions are:

-   How should unstructured product inputs become a stable, normalized
    representation?
-   How should creative generation be separated from creative selection
    and script expansion?
-   How can model outputs be compiled into a structured specification
    before expensive media generation?
-   Which decisions should be deterministic, and which should be
    delegated to models?
-   How can model usage, prompt versions, stage lineage, and failures be
    traced?
-   How can quality checks trigger bounded repair without creating
    uncontrolled generation cost?

## 6. Public research scope

The Research Edition prioritizes the AI pipeline, media workflow,
quality controls, and technical documentation. Production-only user
records, credentials, payment transactions, OTP/session data, credit
ledgers, and email operations are excluded.

The project documentation distinguishes three layers:

-   **Live product:** the customer-facing service at adtrier.com.
-   **Production architecture:** the complete commercial application and
    its hosted services.
-   **Research Edition:** a reduced, safer presentation of the core
    generation-engine concepts.

This distinction is important: the public repository is not presented as
a complete, independently deployable copy of the commercial SaaS.
