import {
  checkIsNotLocalFile,
  Context,
  ContextValue,
  deepMerge,
  getGlobalObject,
  isPercentage,
  makeGlobal,
  monitor,
  UserConfiguration,
} from '@datadog/browser-core'
import { HandlerType, Logger, LogsMessage, StatusType } from './logger'
import { startLogs } from './logs'

export interface LogsUserConfiguration extends UserConfiguration {
  forwardErrorsToLogs?: boolean
}

export interface LoggerConfiguration {
  level?: StatusType
  handler?: HandlerType
  context?: Context
}

export type Status = keyof typeof StatusType

export type LogsGlobal = ReturnType<typeof makeLogsGlobal>

export const datadogLogs = makeLogsGlobal()

interface BrowserWindow extends Window {
  DD_LOGS?: LogsGlobal
}

getGlobalObject<BrowserWindow>().DD_LOGS = datadogLogs

export function makeLogsGlobal() {
  let isAlreadyInitialized = false

  let globalContext: Context = {}
  const customLoggers: { [name: string]: Logger | undefined } = {}

  const beforeInitSendLog: Array<[LogsMessage, Context]> = []
  let sendLogStrategy = (message: LogsMessage, context: Context) => {
    beforeInitSendLog.push([message, context])
  }

  const logger = new Logger(sendLog)

  return makeGlobal({
    logger,

    init: monitor((userConfiguration: LogsUserConfiguration) => {
      if (!checkIsNotLocalFile() || !canInitLogs(userConfiguration)) {
        return
      }

      if (userConfiguration.publicApiKey) {
        userConfiguration.clientToken = userConfiguration.publicApiKey
        console.warn('Public API Key is deprecated. Please use Client Token instead.')
      }
      const isCollectingError = userConfiguration.forwardErrorsToLogs !== false
      const logsUserConfiguration = {
        ...userConfiguration,
        isCollectingError,
      }
      ;({ sendLog: sendLogStrategy } = startLogs(logsUserConfiguration, logger, () => globalContext))

      beforeInitSendLog.forEach(([message, context]) => sendLogStrategy(message, context))

      isAlreadyInitialized = true
    }),

    setLoggerGlobalContext: (context: Context) => {
      globalContext = context
    },

    addLoggerGlobalContext: (key: string, value: ContextValue) => {
      globalContext[key] = value
    },

    removeLoggerGlobalContext: (key: string) => {
      delete globalContext[key]
    },

    createLogger: (name: string, conf: LoggerConfiguration = {}) => {
      customLoggers[name] = new Logger(sendLog, conf.handler, conf.level, {
        ...conf.context,
        logger: { name },
      })
      return customLoggers[name]!
    },

    getLogger: (name: string) => {
      return customLoggers[name]
    },
  })

  function sendLog(message: LogsMessage) {
    sendLogStrategy(message, deepMerge(
      {
        date: Date.now(),
        view: {
          referrer: document.referrer,
          url: window.location.href,
        },
      },
      globalContext
    ) as Context)
  }

  function canInitLogs(userConfiguration: LogsUserConfiguration) {
    if (isAlreadyInitialized) {
      if (!userConfiguration.silentMultipleInit) {
        console.error('DD_LOGS is already initialized.')
      }
      return false
    }
    if (!userConfiguration || (!userConfiguration.publicApiKey && !userConfiguration.clientToken)) {
      console.error('Client Token is not configured, we will not send any data.')
      return false
    }
    if (userConfiguration.sampleRate !== undefined && !isPercentage(userConfiguration.sampleRate)) {
      console.error('Sample Rate should be a number between 0 and 100')
      return false
    }
    return true
  }
}
