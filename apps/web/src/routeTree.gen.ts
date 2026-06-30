/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file is checked in so the MVP can run before the first local route generation.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as ChatNewRouteImport } from './routes/chat/new'
import { Route as ChatIdRouteImport } from './routes/chat/$id'
import { Route as ChatIdReportRouteImport } from './routes/chat/$id/report'
import { Route as ChatIdSharedRouteImport } from './routes/chat/$id/shared'
import { Route as ApiSplatRouteImport } from './routes/api/$'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const ChatNewRoute = ChatNewRouteImport.update({
  id: '/chat/new',
  path: '/chat/new',
  getParentRoute: () => rootRouteImport,
} as any)
const ChatIdRoute = ChatIdRouteImport.update({
  id: '/chat/$id',
  path: '/chat/$id',
  getParentRoute: () => rootRouteImport,
} as any)
const ChatIdReportRoute = ChatIdReportRouteImport.update({
  id: '/chat/$id/report',
  path: '/chat/$id/report',
  getParentRoute: () => rootRouteImport,
} as any)
const ChatIdSharedRoute = ChatIdSharedRouteImport.update({
  id: '/chat/$id/shared',
  path: '/chat/$id/shared',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiSplatRoute = ApiSplatRouteImport.update({
  id: '/api/$',
  path: '/api/$',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/api/$': typeof ApiSplatRoute
  '/chat/new': typeof ChatNewRoute
  '/chat/$id': typeof ChatIdRoute
  '/chat/$id/report': typeof ChatIdReportRoute
  '/chat/$id/shared': typeof ChatIdSharedRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/api/$': typeof ApiSplatRoute
  '/chat/new': typeof ChatNewRoute
  '/chat/$id': typeof ChatIdRoute
  '/chat/$id/report': typeof ChatIdReportRoute
  '/chat/$id/shared': typeof ChatIdSharedRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/api/$': typeof ApiSplatRoute
  '/chat/new': typeof ChatNewRoute
  '/chat/$id': typeof ChatIdRoute
  '/chat/$id/report': typeof ChatIdReportRoute
  '/chat/$id/shared': typeof ChatIdSharedRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/api/$' | '/chat/new' | '/chat/$id' | '/chat/$id/report' | '/chat/$id/shared'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/api/$' | '/chat/new' | '/chat/$id' | '/chat/$id/report' | '/chat/$id/shared'
  id: '__root__' | '/' | '/api/$' | '/chat/new' | '/chat/$id' | '/chat/$id/report' | '/chat/$id/shared'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  ApiSplatRoute: typeof ApiSplatRoute
  ChatNewRoute: typeof ChatNewRoute
  ChatIdRoute: typeof ChatIdRoute
  ChatIdReportRoute: typeof ChatIdReportRoute
  ChatIdSharedRoute: typeof ChatIdSharedRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/chat/new': {
      id: '/chat/new'
      path: '/chat/new'
      fullPath: '/chat/new'
      preLoaderRoute: typeof ChatNewRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/chat/$id': {
      id: '/chat/$id'
      path: '/chat/$id'
      fullPath: '/chat/$id'
      preLoaderRoute: typeof ChatIdRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/chat/$id/report': {
      id: '/chat/$id/report'
      path: '/chat/$id/report'
      fullPath: '/chat/$id/report'
      preLoaderRoute: typeof ChatIdReportRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/chat/$id/shared': {
      id: '/chat/$id/shared'
      path: '/chat/$id/shared'
      fullPath: '/chat/$id/shared'
      preLoaderRoute: typeof ChatIdSharedRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/$': {
      id: '/api/$'
      path: '/api/$'
      fullPath: '/api/$'
      preLoaderRoute: typeof ApiSplatRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  ApiSplatRoute: ApiSplatRoute,
  ChatNewRoute: ChatNewRoute,
  ChatIdRoute: ChatIdRoute,
  ChatIdReportRoute: ChatIdReportRoute,
  ChatIdSharedRoute: ChatIdSharedRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

import type { getRouter } from './router.tsx'
import type { createStart } from '@tanstack/react-start'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
