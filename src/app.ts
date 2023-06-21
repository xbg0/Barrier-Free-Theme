import { ExtensionContext, window, ConfigurationChangeEvent, workspace, commands } from 'vscode'
import controller from './modules/controller'
import configManager from './modules/config'
import cacheManager from './modules/cache'
import queueManager from './modules/queue'
import eventManager from './modules/event'
import listenerManager from './modules/listener'

queueManager.addQueue('updateUserConfig', {
    handler({ section, value }: { section: string; value: any }) {
        return configManager.updateUserConfig(section, value)
    },
    rejected({ item, section, value }: { item: string; section: string; value: any }, error: string) {
        window.showErrorMessage(error)
        // console.log('Transaction: updateUserConfig failed: ', section, value)
    },
    resolved({ item, section, value }: { item: string; section: string; value: any }) {
        // cacheManager.updateCacheWithMap(item, new Map([[section, value]])).then(() => {
        // console.log('Transaction: resolved', section, value, cacheManager.getCache(item))
        // })
    },
    end(succeeded, failed): void {
        const item = succeeded[0].item
        const config = new Map()

        for (const { section, value } of succeeded) {
            config.set(section, value)
        }

        for (const { section, value } of failed) {
            if (Object.is(value, configManager.getUserConfig(section))) { config.set(section, value) }
        }

        if (config.size) {
            cacheManager.updateCacheWithMap(item, config).then(() => {
                // console.log('Transaction: succeeded', new Map(JSON.parse(cacheManager.getCache(item) as string)).size)
            })
        }
    }
})

type configSet = { [propName: string]: Map<string, any> }

eventManager
    .addEvent('setUserConfig', {
        defaultArgs: {
            experienceModeOn: new Map(
                Object.entries({
                    'editor.foldingHighlight': false,
                    'editor.hideCursorInOverviewRuler': true,
                    'editor.scrollbar.verticalScrollbarSize': 24,
                    'editor.smoothScrolling': true,
                    'workbench.list.smoothScrolling': true
                })
            ),
            experienceModeAdvance: new Map(
                Object.entries({
                    'editor.minimap.enabled': false,
                    'editor.foldingHighlight': false,
                    'editor.hideCursorInOverviewRuler': true,
                    'editor.scrollbar.verticalScrollbarSize': 24,
                    'editor.smoothScrolling': true,
                    'editor.stickyScroll.enabled': true,
                    'workbench.list.smoothScrolling': true
                })
            )
        } as configSet,
        method(defaultArgs: configSet, item: string, configIndex: string) {
            const cache = cacheManager.getCache(item)
            const cacheConfig: Map<string, any> = new Map(cache && JSON.parse(cache))
            const config = defaultArgs[configIndex]
            const changes: object[] = []

            for (const [section, value] of config) {
                const userConfigValue = configManager.getUserConfig(section)
                const cacheConfigValue = cacheConfig.get(section)
                if (
                    userConfigValue === undefined ||
                    (!Object.is(cacheConfigValue, value) && Object.is(userConfigValue, cacheConfigValue))
                ) {
                    changes.push({ item, section, value })
                }
            }

            for (const [section, value] of cacheConfig) {
                if (!config.has(section) && Object.is(value, configManager.getUserConfig(section))) {
                    changes.push({ item, section, value: undefined })
                }
            }

            if (changes.length) {
                queueManager.startQueue('updateUserConfig', changes)
            }
        }
    })
    .addEvent('restoreUserConfig', {
        method(item: string) {
            const cache = cacheManager.getCache(item)
            const changes = []

            if (cache) {
                const cacheConfig: Map<string, any> = new Map(JSON.parse(cache))

                for (const [section, value] of cacheConfig) {
                    if (configManager.getUserConfig(section) === value) {
                        changes.push({ item, section, value: undefined })
                    }
                }
            }

            if (changes.length) {
                queueManager.startQueue('updateUserConfig', changes)
            }
        }
    })
    .addEvent('mergeTextMateRules', {
        defaultArgs: {
            fontStyleBold: new Map(
                Object.entries({
                    'editor.tokenColorCustomizations': {
                        textMateRules: [
                            {
                                name: 'Font Style: Bold',
                                scope: ['constant', 'entity.name.function', 'meta.function-call.python'],
                                settings: {
                                    fontStyle: 'bold'
                                }
                            }
                        ]
                    }
                })
            )
        } as configSet,
        method(defaultArgs: configSet, item: string, configIndex: string) {
            const config = defaultArgs[configIndex]
            const editorTokenColorCustomizations = config.get('editor.tokenColorCustomizations')
            const userEditorTokenColorCustomizations = configManager.getUserConfig('editor.tokenColorCustomizations')
            const cacheScope: Set<string> = new Set(editorTokenColorCustomizations.textMateRules[0].scope)
            let changes: null | object = null

            if (userEditorTokenColorCustomizations) {
                const textMateRules: { name: string; scope: string[]; settings: { fontStyle: string } }[] = editorTokenColorCustomizations.textMateRules
                const userTextMateRules: { name: string; scope: string[]; settings: { fontStyle: string } }[] =
                    userEditorTokenColorCustomizations.textMateRules

                if (userTextMateRules) {
                    const example = textMateRules[0]
                    const scope = example.scope
                    const len = userTextMateRules.length

                    if (len) {
                        for (let i = 0; i < len; i++) {
                            const item = userTextMateRules[i]
                            const { name, scope: userScope, settings } = item

                            if (name === 'Font Style: Bold' && settings && Object.keys(settings).length === 1 && settings.fontStyle === 'bold') {
                                if (userScope) {
                                    const userScopeSet = new Set(userScope)
                                    cacheScope.clear()

                                    for (const value of scope) {
                                        if (!userScopeSet.has(value)) {
                                            userScopeSet.add(value)
                                            cacheScope.add(value)
                                        }
                                    }

                                    item.scope = [...userScopeSet]
                                } else {
                                    item.scope = scope
                                }

                                break
                            } else if (i + 1 === len) {
                                userTextMateRules.push(example)
                                break
                            }
                        }
                    } else {
                        userTextMateRules.push(example)
                    }
                } else {
                    userEditorTokenColorCustomizations.textMateRules = textMateRules
                }

                changes = userEditorTokenColorCustomizations
            } else {
                changes = editorTokenColorCustomizations
            }

            if (cacheScope.size) {
                cacheManager.updateCache(item, JSON.stringify([...cacheScope])).then(() => {
                    configManager.updateUserConfig('editor.tokenColorCustomizations', changes)
                    // console.log(cacheManager.getCache(item))
                })
            }
        }
    })
    .addEvent('restoreTextMateRules', {
        method(item: string) {
            const cache = cacheManager.getCache(item)

            if (cache) {
                const cacheScope: Set<string> = new Set(JSON.parse(cache))
                let userEditorTokenColorCustomizations = configManager.getUserConfig('editor.tokenColorCustomizations')
                let isChanged = false

                if (userEditorTokenColorCustomizations) {
                    const userTextMateRules: { name: string; scope: string[]; settings: { fontStyle: string } }[] =
                        userEditorTokenColorCustomizations.textMateRules

                    if (userTextMateRules) {
                        for (let i = 0, len = userTextMateRules.length; i < len; i++) {
                            const item = userTextMateRules[i]
                            const { name, scope: userScope, settings } = item

                            if (name === 'Font Style: Bold' && settings && Object.keys(settings).length === 1 && settings.fontStyle === 'bold') {
                                if (userScope) {
                                    const userScopeSet = new Set(userScope)

                                    for (const value of cacheScope) {
                                        if (userScopeSet.has(value)) {
                                            userScopeSet.delete(value)
                                            isChanged = true
                                        }
                                    }

                                    if (isChanged) {
                                        item.scope = [...userScopeSet]
                                    }
                                }

                                if (!userScope || !item.scope.length) {
                                    if (userTextMateRules.length === 1) {
                                        if (Object.keys(userEditorTokenColorCustomizations).length === 1) {
                                            userEditorTokenColorCustomizations = undefined
                                        } else {
                                            userEditorTokenColorCustomizations.textMateRules = undefined
                                        }
                                    } else {
                                        userTextMateRules.splice(i, 1)
                                    }
                                    isChanged = true
                                }

                                break
                            }
                        }
                    }
                }

                cacheManager.updateCache(item).then(() => {
                    if (isChanged) {
                        configManager.updateUserConfig('editor.tokenColorCustomizations', userEditorTokenColorCustomizations)
                    }
                })
            }
        }
    })
    .addEvent('applyConfig', {
        method() {
            const cache = cacheManager.getCache('barrier-free-theme.fontStyle.bold')

            if (!cache) {
                const config = configManager.getUserConfig('barrier-free-theme.fontStyle.bold')

                if (!config) {
                    eventManager.executeEvent('mergeTextMateRules', 'barrier-free-theme.fontStyle.bold', 'fontStyleBold')
                }
            }
        }
    })

listenerManager
    .addListener({
        status: [
            {
                item: 'barrier-free-theme.experienceMode',
                callback() {
                    const configValue = configManager.getUserConfig('barrier-free-theme.experienceMode')

                    switch (configValue) {
                        case undefined:
                            eventManager.executeEvent('restoreUserConfiguration', 'barrier-free-theme.experienceMode')
                            break
                        case 'on':
                            eventManager.executeEvent('setUserConfiguration', 'barrier-free-theme.experienceMode', 'experienceModeOn')
                            break
                        case 'advance':
                            eventManager.executeEvent('setUserConfiguration', 'barrier-free-theme.experienceMode', 'experienceModeAdvance')
                    }
                }
            },
            {
                item: 'barrier-free-theme.fontStyle.bold',
                callback() {
                    const configValue = configManager.getUserConfig('barrier-free-theme.fontStyle.bold')

                    switch (configValue) {
                        case undefined:
                            eventManager.executeEvent('mergeTextMateRules', 'barrier-free-theme.fontStyle.bold', 'fontStyleBold')
                            break
                        case false:
                            eventManager.executeEvent('restoreTextMateRules', 'barrier-free-theme.fontStyle.bold')
                    }
                }
            }
        ],
        register(item, callback) {
            return workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
                if (e.affectsConfiguration(item)) {
                    callback()
                }
            })
        }
    })
    .addListener({
        status: [
            {
                item: 'barrier-free-theme.enableBoldDisplay',
                callback() {
                    configManager.updateUserConfig('barrier-free-theme.fontStyle.bold', undefined)
                }
            },
            {
                item: 'barrier-free-theme.disableBoldDisplay',
                callback() {
                    configManager.updateUserConfig('barrier-free-theme.fontStyle.bold', false)
                }
            }
        ],
        register(item, callback) {
            return commands.registerCommand(item, callback)
        }
    })

exports.activate = (context: ExtensionContext): void => {
    controller.initialize(context)
    eventManager.executeEvent('applyConfig')
    // console.log('Initialized:', cacheManager.getCache('barrier-free-theme.fontStyle.bold'))
}

exports.deactivate = (context: ExtensionContext): void => {
    context.subscriptions.push(...controller.recoverer)
    // console.log('Deactivated:', cacheManager.getCache('barrier-free-theme.fontStyle.bold'))
}
