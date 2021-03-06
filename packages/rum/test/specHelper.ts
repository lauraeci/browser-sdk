import {
  assign,
  buildUrl,
  combine,
  Configuration,
  Context,
  DEFAULT_CONFIGURATION,
  noop,
  SPEC_ENDPOINTS,
  withSnakeCaseKeys,
} from '@datadog/browser-core'
import { LifeCycle, LifeCycleEventType } from '../src/domain/lifeCycle'
import { ParentContexts } from '../src/domain/parentContexts'
import { RumSession } from '../src/domain/rumSession'
import { RawRumEvent } from '../src/types'
import { RawRumEventV2, RumContextV2, ViewContextV2 } from '../src/typesV2'
import { validateFormat } from './formatValidation'

export interface TestSetupBuilder {
  withFakeLocation: (initialUrl: string) => TestSetupBuilder
  withSession: (session: RumSession) => TestSetupBuilder
  withConfiguration: (overrides: Partial<Configuration>) => TestSetupBuilder
  withParentContexts: (stub: Partial<ParentContexts>) => TestSetupBuilder
  withFakeClock: () => TestSetupBuilder
  beforeBuild: (callback: BeforeBuildCallback) => TestSetupBuilder

  cleanup: () => void
  build: () => TestIO
}

type BeforeBuildCallback = (buildContext: BuildContext) => void | ({ stop?(): void })
interface BuildContext {
  lifeCycle: LifeCycle
  configuration: Readonly<Configuration>
  session: RumSession
  location: Location
  applicationId: string
  parentContexts: ParentContexts
}

export interface TestIO {
  lifeCycle: LifeCycle
  clock: jasmine.Clock
  fakeLocation: Partial<Location>
  session: RumSession
  rawRumEvents: Array<{
    startTime: number
    rawRumEvent: RawRumEvent
    savedGlobalContext?: Context
    customerContext?: Context
  }>
  rawRumEventsV2: Array<{
    startTime: number
    rawRumEvent: RawRumEventV2
    savedGlobalContext?: Context
    customerContext?: Context
  }>
}

export function setup(): TestSetupBuilder {
  let session = {
    getId: () => '1234' as string | undefined,
    isTracked: () => true,
    isTrackedWithResource: () => true,
  }
  const lifeCycle = new LifeCycle()
  const cleanupTasks: Array<() => void> = []
  let cleanupClock = noop
  const beforeBuildTasks: BeforeBuildCallback[] = []
  const rawRumEvents: Array<{
    startTime: number
    rawRumEvent: RawRumEvent
    savedGlobalContext?: Context
    customerContext?: Context
  }> = []
  const rawRumEventsV2: Array<{
    startTime: number
    rawRumEvent: RawRumEventV2
    savedGlobalContext?: Context
    customerContext?: Context
  }> = []

  let clock: jasmine.Clock
  let fakeLocation: Partial<Location> = location
  let parentContexts: ParentContexts
  const configuration: Partial<Configuration> = {
    ...DEFAULT_CONFIGURATION,
    ...SPEC_ENDPOINTS,
    isEnabled: () => true,
  }
  const FAKE_APP_ID = 'appId'

  // ensure that events generated before build are collected
  lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, (data) => rawRumEvents.push(data))
  const rawRumEventsV2Collected = lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_V2_COLLECTED, (data) => {
    rawRumEventsV2.push(data)
    validateRumEventFormat(data.rawRumEvent)
  })

  const setupBuilder = {
    withFakeLocation(initialUrl: string) {
      fakeLocation = buildLocation(initialUrl, location.href)
      spyOn(history, 'pushState').and.callFake((_: any, __: string, pathname: string) => {
        assign(fakeLocation, buildLocation(pathname, fakeLocation.href!))
      })

      function hashchangeCallBack() {
        fakeLocation.hash = window.location.hash
      }

      window.addEventListener('hashchange', hashchangeCallBack)

      cleanupTasks.push(() => {
        window.removeEventListener('hashchange', hashchangeCallBack)
        window.location.hash = ''
      })

      return setupBuilder
    },
    withSession(sessionStub: RumSession) {
      session = sessionStub
      return setupBuilder
    },
    withConfiguration(overrides: Partial<Configuration>) {
      assign(configuration, overrides)
      return setupBuilder
    },
    withParentContexts(stub: Partial<ParentContexts>) {
      parentContexts = stub as ParentContexts
      return setupBuilder
    },
    withFakeClock() {
      jasmine.clock().install()
      jasmine.clock().mockDate()
      const start = Date.now()
      spyOn(performance, 'now').and.callFake(() => Date.now() - start)
      clock = jasmine.clock()
      cleanupClock = () => jasmine.clock().uninstall()
      return setupBuilder
    },
    beforeBuild(callback: BeforeBuildCallback) {
      beforeBuildTasks.push(callback)
      return setupBuilder
    },
    build() {
      beforeBuildTasks.forEach((task) => {
        const result = task({
          lifeCycle,
          parentContexts,
          session,
          applicationId: FAKE_APP_ID,
          configuration: configuration as Configuration,
          location: fakeLocation as Location,
        })
        if (result && result.stop) {
          cleanupTasks.push(result.stop)
        }
      })
      return {
        clock,
        fakeLocation,
        lifeCycle,
        rawRumEvents,
        rawRumEventsV2,
        session,
      }
    },
    cleanup() {
      cleanupTasks.forEach((task) => task())
      // perform these steps at the end to generate correct events in cleanup and validate them
      cleanupClock()
      rawRumEventsV2Collected.unsubscribe()
    },
  }
  return setupBuilder
}

function buildLocation(url: string, base?: string) {
  const urlObject = buildUrl(url, base)
  return {
    hash: urlObject.hash,
    href: urlObject.href,
    pathname: urlObject.pathname,
    search: urlObject.search,
  }
}

function validateRumEventFormat(rawRumEvent: RawRumEventV2) {
  const fakeId = '00000000-aaaa-0000-aaaa-000000000000'
  const fakeContext: RumContextV2 & ViewContextV2 = {
    _dd: {
      formatVersion: 2,
    },
    application: {
      id: fakeId,
    },
    date: 0,
    session: {
      id: fakeId,
      type: 'user',
    },
    view: {
      id: fakeId,
      referrer: '',
      url: 'fake url',
    },
  }
  validateFormat(withSnakeCaseKeys(combine(fakeContext, rawRumEvent)))
}
