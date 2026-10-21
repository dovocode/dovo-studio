import { writeFileSync } from 'node:fs'
import { tokenStyles } from './dist/tokens.js'
writeFileSync(new URL('./dist/tokens.css', import.meta.url), tokenStyles + '\n')
