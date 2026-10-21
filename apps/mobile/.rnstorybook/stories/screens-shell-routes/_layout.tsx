import { CatalogNavigationTheme } from '../../../src/catalog/screens-navigation-theme'
import { Workbench } from '../../../src/shell/workbench'
import { MobileScreenProviders } from '../../../src/catalog/screens-runtime'
/** Actual production native tab/stack shell, synthetic offline state, no App effects. */
export default function CatalogWorkbenchLayout() {
  return (
    <MobileScreenProviders state="offline">
      <CatalogNavigationTheme>
        <Workbench />
      </CatalogNavigationTheme>
    </MobileScreenProviders>
  )
}
