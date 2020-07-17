import { RumEvent, ViewDetail, RUM_EVENT_COLOR } from './rumEvents'

export function updateViewDetails({ event }: { event: RumEvent }, viewDetails: ViewDetail[]) {
  let parentViewDetail = viewDetails.find((viewDetail) => viewDetail.id === event.view.id)
  if (!parentViewDetail) {
    parentViewDetail = {
      date: event.date,
      description: computeDescription('view', event),
      events: [],
      id: event.view.id,
    }
    viewDetails.push(parentViewDetail)
  }
  if (event.evt.category !== 'view') {
    parentViewDetail.events.push({
      event,
      date: event.date,
      description: computeDescription(event.evt.category, event),
      color: RUM_EVENT_COLOR[event.evt.category] || RUM_EVENT_COLOR['default'],
    })
  }
  return viewDetails
}

function computeDescription(type: string, event: RumEvent) {
  switch (type) {
    case 'view':
      const viewUrl = new URL(event.view.url)
      return `View path ${viewUrl.pathname}`
    case 'resource':
      return `Resource ${event.http.url}`
    case 'long_task':
      return `Long task of ${Math.round(event.duration / 1000000)}ms`
    case 'error':
      return event.message
    case 'user_action':
      if (event.userAction.type === 'custom') {
        return `Custom action ${event.evt.name}`
      }
      return `Click on ${event.evt.name}`
    default:
      return type
  }
}