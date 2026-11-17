# Model routing and execution

## Capability registry

`src/lib/ai/registry.ts` is the single source of truth for default capability routing.

| Capability | Default provider | Logical tier | Reasoning level |
|---|---|---|---|
| `understandText` | Volcengine | Lite | minimal |
| `understandImages` | Volcengine | Lite | minimal |
| `understandVideo` | Volcengine | Lite | minimal |
| `generateCreative` | Volcengine | Lite | minimal |
| `selectCreative` | Volcengine | Pro | high |
| `expandScript` | Volcengine | Pro | medium |
| `validateAd` | Volcengine | Pro | high |

The mapping is capability-based, not a general-purpose autonomous router. A logical model name is resolved to a concrete Ark model/endpoint ID by `volcengine-models.ts`.

## Environment overrides

- `SEED_2_1_LITE_API`: preferred credential for Lite capabilities.
- `SEED_2_1_PRO_API`: preferred credential for Pro capabilities; the implementation can fall back to the Lite credential when the Pro key is absent.
- `ARK_API_KEY`: legacy/shared fallback.
- `ARK_MODEL_LITE`, `ARK_MODEL_PRO`: optional concrete model/endpoint overrides.
- `EXPAND_SCRIPT_REASONING`: optional evaluation override for script expansion.
- `UNDERSTANDING_PROMPT_VERSION`, `CREATIVE_PROMPT_VERSION`: prompt-version overrides used in provenance and cache isolation.
- `DOUBAO_EMBEDDING_VISION_API`: separate embedding credential; it is not used as a chat key.

The Gemini adapter is retained as an alternate provider implementation, but the checked-in registry maps all seven default capabilities to Volcengine. Provider/model overrides are available for tests and experiments; there is no automatic provider failover chain.

## Structured output and error handling

The runner:

1. reads the capability registry;
2. resolves the provider, model, and reasoning level;
3. calls the selected provider adapter with a JSON schema;
4. verifies the result is an object;
5. attaches usage/provenance metadata;
6. normalizes provider errors into quota, timeout, provider, validation, or unknown categories.

Retryable provider failures receive at most one retry. If the provider rejects a reasoning-effort value, the adapter may downgrade that value once and retry. This is not an automatic switch to a different provider.

## Usage records

Each call records capability, provider, model, prompt version, status, latency, cache state, optional token counts, and normalized error metadata. Token counts are omitted when the provider does not return them.

