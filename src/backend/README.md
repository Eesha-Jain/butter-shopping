# Backend

| Path | Purpose |
| --- | --- |
| [`types/`](types/) | Shared domain types used across screens and services |
| [`supabase/`](supabase/) | Supabase client and typed data-access functions |
| [`errors.ts`](errors.ts) | `AppError`, `fail`, `runAction` |
| [`toast.ts`](toast.ts) | Burnt success/error toasts |
| [`index.ts`](index.ts) | Public import surface: `@/backend` |

```ts
import { signIn, listMyGroups, type Profile } from '@/backend';
import type { FulfillmentMethod } from '@/backend/types';
```

See [`supabase/README.md`](supabase/README.md) for the data model and function catalog.
