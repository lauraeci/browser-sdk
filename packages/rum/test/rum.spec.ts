import sinon from 'sinon'

import { Configuration, DEFAULT_CONFIGURATION } from '@browser-agent/core/src/configuration'
import { ErrorMessage } from '@browser-agent/core/src/errorCollection'
import { Observable } from '@browser-agent/core/src/observable'
import { RequestDetails } from '@browser-agent/core/src/requestCollection'
import { isIE, PerformanceObserverStubBuilder } from '@browser-agent/core/test/specHelper'

import {
  handlePaintEntry,
  handleResourceEntry,
  PerformancePaintTiming,
  RumEvent,
  RumEventCategory,
  RumResourceEvent,
  startRum,
} from '../src/rum'
import { RumGlobal } from '../src/rum.entry'

function getEntry(addRumEvent: (event: RumEvent) => void, index: number) {
  return (addRumEvent as jasmine.Spy).calls.argsFor(index)[0] as RumEvent
}

const configuration = {
  ...DEFAULT_CONFIGURATION,
  internalMonitoringEndpoint: 'monitoring',
  logsEndpoint: 'logs',
  maxBatchSize: 1,
  rumEndpoint: 'rum',
}

describe('rum handle performance entry', () => {
  let addRumEvent: (event: RumEvent) => void

  beforeEach(() => {
    if (isIE()) {
      pending('no full rum support')
    }
    addRumEvent = jasmine.createSpy()
  })
  ;[
    {
      description: 'type resource + logs endpoint',
      entry: { entryType: 'resource', name: configuration.logsEndpoint },
      expectEntryToBeAdded: false,
    },
    {
      description: 'type resource + internal monitoring endpoint',
      entry: { entryType: 'resource', name: configuration.internalMonitoringEndpoint },
      expectEntryToBeAdded: false,
    },
    {
      description: 'type resource + rum endpoint',
      entry: { entryType: 'resource', name: configuration.rumEndpoint },
      expectEntryToBeAdded: false,
    },
  ].forEach(
    ({
      description,
      entry,
      expectEntryToBeAdded,
    }: {
      description: string
      entry: Partial<PerformanceResourceTiming>
      expectEntryToBeAdded: boolean
    }) => {
      it(description, () => {
        handleResourceEntry(configuration as Configuration, entry as PerformanceResourceTiming, addRumEvent)
        expect((addRumEvent as jasmine.Spy).calls.all.length !== 0).toEqual(expectEntryToBeAdded)
      })
    }
  )
  ;[
    {
      description: 'file extension with query params',
      expected: 'js',
      url: 'http://localhost/test.js?from=foo.css',
    },
    {
      description: 'css extension',
      expected: 'css',
      url: 'http://localhost/test.css',
    },
    {
      description: 'image initiator',
      expected: 'image',
      initiatorType: 'img',
      url: 'http://localhost/test',
    },
    {
      description: 'image extension',
      expected: 'image',
      url: 'http://localhost/test.jpg',
    },
  ].forEach(
    ({
      description,
      url,
      initiatorType,
      expected,
    }: {
      description: string
      url: string
      initiatorType?: string
      expected: string
    }) => {
      it(`should compute resource kind: ${description}`, () => {
        const entry: Partial<PerformanceResourceTiming> = { initiatorType, name: url, entryType: 'resource' }

        handleResourceEntry(configuration as Configuration, entry as PerformanceResourceTiming, addRumEvent)
        const resourceEvent = getEntry(addRumEvent, 0) as RumResourceEvent
        expect(resourceEvent.resource.kind).toEqual(expected)
      })
    }
  )

  it('should compute timing durations', () => {
    const entry: Partial<PerformanceResourceTiming> = {
      connectEnd: 10,
      connectStart: 3,
      entryType: 'resource',
      name: 'http://localhost/test',
      responseEnd: 100,
      responseStart: 25,
    }

    handleResourceEntry(configuration as Configuration, entry as PerformanceResourceTiming, addRumEvent)
    const resourceEvent = getEntry(addRumEvent, 0) as RumResourceEvent
    expect(resourceEvent.http.performance!.connect.duration).toEqual(7 * 1e6)
    expect(resourceEvent.http.performance!.download.duration).toEqual(75 * 1e6)
  })

  it('should rewrite paint entries', () => {
    const entry: Partial<PerformancePaintTiming> = { name: 'first-paint', startTime: 123456, entryType: 'paint' }
    handlePaintEntry(entry as PerformancePaintTiming, addRumEvent)
    expect(getEntry(addRumEvent, 0)).toEqual({
      evt: {
        category: RumEventCategory.SCREEN_PERFORMANCE,
      },
      screen: {
        performance: {
          'first-paint': 123456 * 1e6,
        },
      },
    })
  })
})

describe('rum session', () => {
  const FAKE_ERROR: Partial<ErrorMessage> = { message: 'test' }
  const FAKE_RESOURCE: Partial<PerformanceEntry> = { name: 'http://foo.com', entryType: 'resource' }
  const FAKE_REQUEST: Partial<RequestDetails> = { url: 'http://foo.com' }
  let server: sinon.SinonFakeServer
  let original: PerformanceObserver | undefined
  let stubBuilder: PerformanceObserverStubBuilder

  beforeEach(() => {
    if (isIE()) {
      pending('no full rum support')
    }
    server = sinon.fakeServer.create()
    original = window.PerformanceObserver
    stubBuilder = new PerformanceObserverStubBuilder()
    window.PerformanceObserver = stubBuilder.getStub()
  })

  afterEach(() => {
    server.restore()
    window.PerformanceObserver = original
  })

  it('when tracked with resources should enable full tracking', () => {
    const trackedWithResourcesSession = {
      getId: () => undefined,
      isTracked: () => true,
      isTrackedWithResource: () => true,
    }
    const errorObservable = new Observable<ErrorMessage>()
    const requestObservable = new Observable<RequestDetails>()
    startRum('appId', errorObservable, requestObservable, configuration as Configuration, trackedWithResourcesSession)
    server.requests = []

    stubBuilder.fakeEntry(FAKE_RESOURCE as PerformanceEntry, 'resource')
    errorObservable.notify(FAKE_ERROR as ErrorMessage)
    requestObservable.notify(FAKE_REQUEST as RequestDetails)

    expect(server.requests.length).toEqual(3)
  })

  it('when tracked without resources should not track resources', () => {
    const trackedWithResourcesSession = {
      getId: () => undefined,
      isTracked: () => true,
      isTrackedWithResource: () => false,
    }
    const errorObservable = new Observable<ErrorMessage>()
    const requestObservable = new Observable<RequestDetails>()
    startRum('appId', errorObservable, requestObservable, configuration as Configuration, trackedWithResourcesSession)
    server.requests = []

    stubBuilder.fakeEntry(FAKE_RESOURCE as PerformanceEntry, 'resource')
    requestObservable.notify(FAKE_REQUEST as RequestDetails)
    expect(server.requests.length).toEqual(0)

    errorObservable.notify(FAKE_ERROR as ErrorMessage)
    expect(server.requests.length).toEqual(1)
  })

  it('when not tracked should disable tracking', () => {
    const notTrackedSession = {
      getId: () => undefined,
      isTracked: () => false,
      isTrackedWithResource: () => false,
    }
    const errorObservable = new Observable<ErrorMessage>()
    const requestObservable = new Observable<RequestDetails>()
    startRum('appId', errorObservable, requestObservable, configuration as Configuration, notTrackedSession)
    server.requests = []

    stubBuilder.fakeEntry(FAKE_RESOURCE as PerformanceEntry, 'resource')
    requestObservable.notify(FAKE_REQUEST as RequestDetails)
    errorObservable.notify(FAKE_ERROR as ErrorMessage)

    expect(server.requests.length).toEqual(0)
  })

  it('when type change should enable/disable existing tracking', () => {
    let isTracked = true
    const session = {
      getId: () => undefined,
      isTracked: () => isTracked,
      isTrackedWithResource: () => isTracked,
    }
    startRum('appId', new Observable(), new Observable(), configuration as Configuration, session)
    server.requests = []

    stubBuilder.fakeEntry(FAKE_RESOURCE as PerformanceEntry, 'resource')
    expect(server.requests.length).toEqual(1)

    isTracked = false
    stubBuilder.fakeEntry(FAKE_RESOURCE as PerformanceEntry, 'resource')
    expect(server.requests.length).toEqual(1)

    isTracked = true
    stubBuilder.fakeEntry(FAKE_RESOURCE as PerformanceEntry, 'resource')
    expect(server.requests.length).toEqual(2)
  })
})

describe('rum init', () => {
  let server: sinon.SinonFakeServer

  beforeEach(() => {
    if (isIE()) {
      pending('no full rum support')
    }
    server = sinon.fakeServer.create()
  })

  afterEach(() => {
    server.restore()
  })

  it('should send buffered performance entries', () => {
    const session = {
      getId: () => undefined,
      isTracked: () => true,
      isTrackedWithResource: () => true,
    }

    startRum('appId', new Observable(), new Observable(), configuration as Configuration, session)

    expect(server.requests.length).toBeGreaterThan(0)
  })
})

type RumApi = Omit<RumGlobal, 'init'>
function getRumMessage(server: sinon.SinonFakeServer, index: number) {
  return JSON.parse(server.requests[index].requestBody) as RumEvent
}

describe('rum global context', () => {
  const FAKE_ERROR: Partial<ErrorMessage> = { message: 'test' }
  let errorObservable: Observable<ErrorMessage>
  let RUM: RumApi
  let server: sinon.SinonFakeServer

  beforeEach(() => {
    const session = {
      getId: () => undefined,
      isTracked: () => true,
      isTrackedWithResource: () => true,
    }
    server = sinon.fakeServer.create()
    errorObservable = new Observable<ErrorMessage>()
    RUM = startRum('appId', errorObservable, new Observable(), configuration as Configuration, session) as RumApi
    server.requests = []
  })

  afterEach(() => {
    server.restore()
  })

  it('should be added to the request', () => {
    RUM.setRumGlobalContext({ bar: 'foo' })
    errorObservable.notify(FAKE_ERROR as ErrorMessage)

    expect((getRumMessage(server, 0) as any).bar).toEqual('foo')
  })

  it('should be updatable', () => {
    RUM.setRumGlobalContext({ bar: 'foo' })
    errorObservable.notify(FAKE_ERROR as ErrorMessage)
    RUM.setRumGlobalContext({ foo: 'bar' })
    errorObservable.notify(FAKE_ERROR as ErrorMessage)

    expect((getRumMessage(server, 0) as any).bar).toEqual('foo')
    expect((getRumMessage(server, 1) as any).foo).toEqual('bar')
    expect((getRumMessage(server, 1) as any).bar).toBeUndefined()
  })
})