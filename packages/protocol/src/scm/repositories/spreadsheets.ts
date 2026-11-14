import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '../../shared/schema.js'
export const spreadsheetPreviewSchema = mutableStruct({
  sheets: mutableArray(Schema.String),
  sheet: Schema.String,
  rows: mutableArray(mutableArray(Schema.String)),
  truncated: Schema.Boolean,
})
export type SpreadsheetPreview = typeof spreadsheetPreviewSchema.Type
export const isSpreadsheet = (path: string) => /\.(xlsx|xls|ods|csv|tsv)$/i.test(path)
