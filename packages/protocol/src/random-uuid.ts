// uuid falls back to getRandomValues when HTTP browsers lack native randomUUID.
export { v4 as randomUUID } from 'uuid'
