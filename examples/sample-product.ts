import type { ProductStageInput } from "../src/lib/product-stage-input";

export const sampleProductInput: ProductStageInput = {
  version: 1,
  jobId: "sample-product-001",
  source: {
    url: "https://store.example.test/products/insulated-travel-bottle",
    kind: "manual",
  },
  product: {
    title: "Insulated Travel Bottle",
    description:
      "A reusable stainless-steel bottle with a double-wall body, a leak-resistant lid, and a wide mouth for easy cleaning. Designed for commuting, desk use, and weekend trips.",
    bullets: [
      "Double-wall stainless-steel construction",
      "Leak-resistant screw lid",
      "Wide mouth for easy cleaning",
      "Reusable everyday format",
    ],
    pricing: {
      currency: "USD",
      listPrice: "$24.00",
    },
    audience: "Commuters and everyday carry users",
    notes:
      "Keep claims factual. Avoid health, temperature-duration, or performance guarantees that are not stated in the supplied product information.",
  },
  branding: {
    brand: "Northstar Sample Co.",
  },
  media: {
    images: [
      {
        id: "sample-bottle-front",
        url: "https://assets.example.test/sample-bottle.png",
        fileName: "sample-bottle.png",
      },
    ],
    videos: [],
    primaryImageUrl: "https://assets.example.test/sample-bottle.png",
  },
  completeness: {
    readyForNextStage: true,
    missing: [],
  },
};
