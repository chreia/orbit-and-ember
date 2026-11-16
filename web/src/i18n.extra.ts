// Interface strings added after the first Patwa pass: the worldwide view, Ember, the signal network,
// the quick tour and the language picker. English and Rioplatense Spanish live here and in
// strings/*.ts; Patwa lives in i18n.extra.jam.ts, and any key missing there shows in English.
import * as ember from './strings/ember.ts';
import * as live from './strings/live.ts';
import * as terrain from './strings/terrain.ts';
import * as world from './strings/world.ts';

export const enCore = {
  // ---- shared by several parts of the worldwide view
  wholeWorld: 'Whole world',

  // ---- views and tours
  navArgentina: 'Argentina record',
  navArgentinaShort: 'Argentina',
  navMethodsShort: 'Methods',
  navLabel: 'Views',
  langLabel: 'Language',
  taglineWorld: 'Worldwide burning calendar · live satellite fire signals',
  taglineGlobal: 'Worldwide VIIRS fire observations · past 24 hours',
  titleWorld: 'Global fire calendar and live observations',
  sourceNaturalEarth: 'Natural Earth, admin-1 boundaries (public domain)',
  staticWorld: 'The live globe needs WebGL 2, which this browser has turned off. The burning calendar still works, and the Argentina record has a plain map.',
  tourButton: 'Tour',
  howWorld1: 'Taller, brighter columns mean more satellite detections in the past 24 hours.',
  howWorld2: 'Drag to rotate · scroll to zoom · click a column for details.',

  // ---- quick tour of the worldwide view
  qtCount: 'Quick tour · {n} of {total}',
  qtSkipLabel: 'Skip the tour',
  qtSkip: 'Skip tour',
  qtDone: 'Start exploring',
  qtArgentina: 'Tour the Argentina record',
  qtArgentinaHint: 'The harmonized MODIS and VIIRS record for Argentina has its own guided tour.',
  qt1Label: 'Your area',
  qt1Title: 'Choose your area',
  qt1Text: 'Select a country to move the globe and load its historical fire record.',
  qt2Label: 'Burning calendar',
  qt2Title: 'Find unusual months',
  qt2Text: 'Click a month in the burning calendar. Switch to Anomaly to compare burned area with the usual seasonal pattern.',
  qt3Label: 'Live globe',
  qt3Title: 'Explore satellite detections',
  qt3Text: 'Drag to move around Earth. Scroll to zoom, or click a glowing column to explore its observation and terrain. Columns count detections, not flame height.',
  qt4Label: 'Your Earth guide',
  qt4Title: 'Ask Ember',
  qt4Text: 'Try a suggestion such as “California fires”. Ember moves the map and explains the evidence. Use Speak or turn on Voice for spoken guidance.',
  qt5Label: 'Signal network',
  qt5Title: 'Follow a fire signal',
  qt5Text: 'Select a hotspot, then open Signal to see its coordinates, recent detections and alert options. You are ready to explore.',
};

export const enExtra = { ...enCore, ...live.en, ...ember.en, ...world.en, ...terrain.en };
export type ExtraKey = keyof typeof enExtra;

const esCore: Record<keyof typeof enCore, string> = {
  wholeWorld: 'Todo el mundo',

  navArgentina: 'Registro de Argentina',
  navArgentinaShort: 'Argentina',
  navMethodsShort: 'Métodos',
  navLabel: 'Vistas',
  langLabel: 'Idioma',
  taglineWorld: 'Calendario mundial de quemas · señales satelitales de fuego en vivo',
  taglineGlobal: 'Observaciones VIIRS de fuego en el mundo · últimas 24 horas',
  titleWorld: 'Calendario mundial de fuego y observaciones en vivo',
  sourceNaturalEarth: 'Natural Earth, límites provinciales (dominio público)',
  staticWorld: 'El globo en vivo necesita WebGL 2, que este navegador tiene desactivado. El calendario de quemas sigue funcionando y el registro de Argentina tiene un mapa plano.',
  tourButton: 'Recorrido',
  howWorld1: 'Columnas más altas y brillantes significan más detecciones satelitales en las últimas 24 horas.',
  howWorld2: 'Arrastrá para girar · usá la rueda para acercar · hacé clic en una columna para ver detalles.',

  qtCount: 'Recorrido rápido · {n} de {total}',
  qtSkipLabel: 'Saltear el recorrido',
  qtSkip: 'Saltear',
  qtDone: 'Empezar a explorar',
  qtArgentina: 'Recorrer el registro de Argentina',
  qtArgentinaHint: 'El registro armonizado MODIS y VIIRS de Argentina tiene su propio recorrido guiado.',
  qt1Label: 'Tu área',
  qt1Title: 'Elegí tu área',
  qt1Text: 'Elegí un país para mover el globo y cargar su historial de fuego.',
  qt2Label: 'Calendario de quemas',
  qt2Title: 'Encontrá meses inusuales',
  qt2Text: 'Hacé clic en un mes del calendario de quemas. Pasá a Anomalía para comparar el área quemada con el patrón habitual de la temporada.',
  qt3Label: 'Globo en vivo',
  qt3Title: 'Explorá las detecciones satelitales',
  qt3Text: 'Arrastrá para recorrer la Tierra. Usá la rueda para acercar, o hacé clic en una columna encendida para ver su observación y el terreno. Las columnas cuentan detecciones, no la altura de las llamas.',
  qt4Label: 'Tu guía de la Tierra',
  qt4Title: 'Preguntale a Ember',
  qt4Text: 'Probá una sugerencia como «Incendios en California». Ember mueve el mapa y explica la evidencia. Usá Hablar o activá Voz para escuchar la guía.',
  qt5Label: 'Red de señales',
  qt5Title: 'Seguí una señal de fuego',
  qt5Text: 'Elegí un foco y abrí Señal para ver sus coordenadas, las detecciones recientes y las opciones de alerta. Ya podés explorar.',
};

export const esExtra: Record<ExtraKey, string> = { ...esCore, ...live.es, ...ember.es, ...world.es, ...terrain.es };
