import { z } from 'zod'

// Lenient UUID validation matching Postgres's `uuid` type (any 8-4-4-4-12 hex),
// NOT zod v4's strict `.uuid()` which enforces RFC 9562 version/variant nibbles.
// Seed/test accounts use "pretty" ids like 33333333-3333-3333-3333-333333333333,
// which Postgres accepts but zod's .uuid() rejects with "Invalid UUID". Postgres
// remains the final validator, so app-level checks must not be stricter.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const zUuid = (message = 'Некорректный идентификатор') =>
  z.string().regex(UUID_RE, message)
