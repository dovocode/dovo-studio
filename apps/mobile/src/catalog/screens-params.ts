import { createContext } from 'react'
/** Route inputs consumed by the browser-only Expo Router adapter. Native uses real ExpoRoot. */
export const MobileScreenParamsContext = createContext<Record<string, string>>({})
export const mobileScreenRouteParams: Record<string, string> = {
  runtimeId: 'catalog-computer',
  repositoryId: 'catalog-project',
  taskId: 'catalog-task-2',
  number: '42',
  itemId: '17',
  sourceId: 'catalog-jira',
  automationId: 'catalog-job',
}
