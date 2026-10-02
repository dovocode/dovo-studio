import { withPodfile, type ConfigPlugin } from 'expo/config-plugins'

/** CocoaPods' sequential UUID cache can collide after predictabilize_uuids, when RN adds SPM products. */
const withCocoaPodsUUIDs: ConfigPlugin = (config) =>
  withPodfile(config, (mod) => {
    const anchor = 'post_install do |installer|'
    if (!mod.modResults.contents.includes(anchor))
      throw new Error('Cannot install the CocoaPods UUID safeguard: post_install hook is missing')
    if (!mod.modResults.contents.includes('# Dovo: collision-safe post-install UUIDs'))
      mod.modResults.contents = mod.modResults.contents.replace(
        anchor,
        `${anchor}
    # Dovo: collision-safe post-install UUIDs
    project = installer.pods_project
    project.instance_variable_set(:@available_uuids, [])
    project.define_singleton_method(:generate_available_uuid_list) do |count = 100|
      candidates = Array.new(count + 1) { SecureRandom.hex(12).upcase }
      unique = candidates.reject { |id| objects_by_uuid.key?(id) || @generated_uuids.include?(id) }
      @generated_uuids.concat(unique)
      @available_uuids.concat(unique)
    end
`,
      )
    return mod
  })
export default withCocoaPodsUUIDs
