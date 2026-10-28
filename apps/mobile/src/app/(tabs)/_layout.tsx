export { WorkbenchTabs as default } from '../../shell/workbench'

// The compose action is a tab route too; cold starts must anchor on the thread list.
export const unstable_settings = { anchor: '(tasks)' }
