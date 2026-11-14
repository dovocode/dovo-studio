import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
} from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

export const SettingsSearchContext = createContext('')
const ScrollContext = createContext<
  ((label: string, node: ComponentRef<typeof View> | null) => void) | null
>(null)

/** Native measurement keeps search independent of UIKit font and screen sizing. */
export function SettingsScrollView({
  searchHeaderHeight = 0,
  ...props
}: ComponentProps<typeof ScrollView> & { searchHeaderHeight?: number }) {
  const { styles } = useTheme()
  const [missing, setMissing] = useState(false)
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const target = useContext(SettingsSearchContext)
  const nodes = useRef(new Map<string, ComponentRef<typeof View>>())
  const revealed = useRef<{
    target: string
    node: ComponentRef<typeof View>
    header: number
  } | null>(null)
  const reveal = useCallback(
    (label: string, node: ComponentRef<typeof View> | null) => {
      if (!node) {
        nodes.current.delete(label)
        if (revealed.current?.target === label) revealed.current = null
        return
      }
      nodes.current.set(label, node)
      if (!target || label !== target || !scroll.current) return
      setMissing(false)
      if (
        revealed.current?.target === target &&
        revealed.current.node === node &&
        revealed.current.header === searchHeaderHeight
      )
        return
      const content = scroll.current.getInnerViewNode()
      if (content === undefined) return
      node.measureLayout(content, (_x, y) => {
        scroll.current?.scrollTo({ y: Math.max(0, y - searchHeaderHeight - 16), animated: false })
        revealed.current = { target, node, header: searchHeaderHeight }
      })
    },
    [target, searchHeaderHeight],
  )
  useEffect(() => {
    revealed.current = null
    const frame = requestAnimationFrame(() => {
      const node = nodes.current.get(target)
      if (node) reveal(target, node)
      else setMissing(!!target)
    })
    return () => cancelAnimationFrame(frame)
  }, [target, reveal])
  return (
    <ScrollContext.Provider value={reveal}>
      <ScrollView
        {...props}
        ref={scroll}
        onContentSizeChange={(width, height) => {
          const node = nodes.current.get(target)
          if (node) reveal(target, node)
          else setMissing(!!target)
          props.onContentSizeChange?.(width, height)
        }}
      >
        {props.children}
        {missing && (
          <Text accessibilityRole="alert" style={styles.muted}>
            <InterfaceText values={{ value0: target }}>
              {
                '“{value0}” is not available for this settings target. Choose another computer or project, or reconnect and try again.'
              }
            </InterfaceText>
          </Text>
        )}
      </ScrollView>
    </ScrollContext.Provider>
  )
}

export function SettingsAnchor({ label, children }: { label?: string; children: ReactNode }) {
  const uiText = useInterfaceText()
  const sourceTarget = useContext(SettingsSearchContext)
  // URLs and measured scroll targets keep their authored key across language changes.
  const matches = !!label && (label === sourceTarget || label === uiText(sourceTarget))
  const reveal = useContext(ScrollContext)
  const ref = useRef<ComponentRef<typeof View>>(null)
  const { colors } = useTheme()
  const [dismissed, setDismissed] = useState('')
  const selected = matches && dismissed !== sourceTarget
  useEffect(() => {
    if (matches && ref.current) reveal?.(sourceTarget, ref.current)
    return () => {
      if (matches) reveal?.(sourceTarget, null)
    }
  }, [matches, sourceTarget, reveal])
  if (!sourceTarget || !matches) return children
  return (
    <View
      ref={ref}
      testID={selected ? 'Settings search highlight' : undefined}
      collapsable={false}
      onLayout={() => {
        if (ref.current) reveal?.(sourceTarget, ref.current)
      }}
      onTouchStart={() => {
        if (selected) setDismissed(sourceTarget)
      }}
      style={
        selected ? { borderWidth: 2, borderColor: colors.accent, borderRadius: 16 } : undefined
      }
    >
      {children}
    </View>
  )
}
