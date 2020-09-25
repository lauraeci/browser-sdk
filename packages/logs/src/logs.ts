import {
  areCookiesAuthorized,
  Batch,
  commonInit,
  Configuration,
  Context,
  deepMerge,
  ErrorMessage,
  getTimestamp,
  HttpRequest,
} from '@datadog/browser-core'
import { buildEnv } from './buildEnv'
import { Logger, LogsMessage } from './logger'
import { LoggerSession, startLoggerSession } from './loggerSession'
import { LogsUserConfiguration } from './logs.entry'

export function startLogs(
  userConfiguration: LogsUserConfiguration,
  logger: Logger,
  globalContextProvider: () => Context
) {
  const { configuration, errorObservable, internalMonitoring } = commonInit(userConfiguration, buildEnv)
  const session = startLoggerSession(configuration, areCookiesAuthorized(configuration.cookieOptions.secure))
  internalMonitoring.setExternalContextProvider(
    () =>
      deepMerge({ session_id: session.getId() }, globalContextProvider(), getRUMInternalContext() as Context) as Context
  )

  const batch = startLoggerBatch(configuration, session)

  errorObservable.subscribe((e: ErrorMessage) =>
    logger.error(
      e.message,
      deepMerge(
        ({ date: getTimestamp(e.startTime), ...e.context } as unknown) as Context,
        getRUMInternalContext(e.startTime)
      )
    )
  )
  return {
    sendLog: (message: LogsMessage, currentContext: Context) => {
      if (session.isTracked()) {
        batch.add(message, currentContext)
      }
    },
  }
}

function startLoggerBatch(configuration: Configuration, session: LoggerSession) {
  const primaryBatch = createLoggerBatch(configuration.logsEndpoint)

  let replicaBatch: Batch | undefined
  if (configuration.replica !== undefined) {
    replicaBatch = createLoggerBatch(configuration.replica.logsEndpoint)
  }

  function createLoggerBatch(endpointUrl: string) {
    return new Batch(
      new HttpRequest(endpointUrl, configuration.batchBytesLimit),
      configuration.maxBatchSize,
      configuration.batchBytesLimit,
      configuration.maxMessageSize,
      configuration.flushTimeout
    )
  }

  function withInternalContext(message: LogsMessage, currentContext: Context) {
    return deepMerge(
      {
        service: configuration.service,
        session_id: session.getId(),
      },
      currentContext,
      getRUMInternalContext() as Context,
      message
    ) as Context
  }

  return {
    add(message: LogsMessage, currentContext: Context) {
      const contextualizedMessage = withInternalContext(message, currentContext)
      primaryBatch.add(contextualizedMessage)
      if (replicaBatch) {
        replicaBatch.add(contextualizedMessage)
      }
    },
  }
}

interface Rum {
  getInternalContext: (startTime?: number) => Context
}

function getRUMInternalContext(startTime?: number): Context | undefined {
  const rum = (window as any).DD_RUM as Rum
  return rum && rum.getInternalContext ? rum.getInternalContext(startTime) : undefined
}
