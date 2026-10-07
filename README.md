# Telegram Nasiya

Kichik bizneslar uchun Telegram ichidagi nasiya hisobi. Texnik topshiriq: [`docs/Texnik-Topshiriq.md`](docs/Texnik-Topshiriq.md), reja: [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md), qarorlar: [`docs/adr/`](docs/adr/README.md).

## Tuzilma

| Papka               | Vazifa                                                        |
| ------------------- | ------------------------------------------------------------- |
| `apps/server`       | Fastify + grammY, bitta jarayon (webhook, Mini App API, cron) |
| `packages/shared`   | Server va Mini App uchun umumiy tiplar va funksiyalar         |
| `packages/nlp-eval` | Golden dataset va baholash                                    |

## Buyruqlar

```bash
pnpm install
pnpm check            # lint + typecheck + format + test
pnpm test             # vitest
pnpm golden:validate  # golden dataset tekshiruvi
pnpm test:int         # integratsion testlar (scripts/dev-db.sh up kerak)
pnpm dev:miniapp      # Mini App dev server (apps/miniapp/.env.local: pnpm --filter @nasiya/server dev:initdata <tg_id>)
```

Node >= 22, pnpm 11.
