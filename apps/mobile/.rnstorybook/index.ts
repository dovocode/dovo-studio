import AsyncStorage from '@react-native-async-storage/async-storage'
import { dovoColors } from '@dovo/design'
import { view } from './storybook.requires'

const colors = dovoColors.dark
export default view.getStorybookUI({
  storage: { getItem: AsyncStorage.getItem, setItem: AsyncStorage.setItem },
  enableWebsockets: false,
  shouldPersistSelection: true,
  theme: {
    base: 'dark',
    brand: { title: 'Dovo UI' },
    color: { primary: colors.primary, secondary: colors.primary, defaultText: colors.foreground },
    background: {
      app: colors.background,
      content: colors.background,
      preview: colors.background,
      bar: colors.card,
    },
    appBorderColor: colors.border,
    barBg: colors.card,
    barTextColor: colors['muted-foreground'],
    barSelectedColor: colors.foreground,
    input: { background: colors.card, color: colors.foreground, border: colors.border },
  },
})
