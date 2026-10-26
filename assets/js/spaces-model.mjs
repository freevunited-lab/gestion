// FREEV Gestion — NAV 01 : les six espaces du panneau latéral et les vues qu'ils regroupent.
// Module pur, sans DOM : utilisé par l'interface (spaces.js) et par les tests.

export const SPACES = Object.freeze([
  { id: 'dashboard', label: 'Tableau de bord', primary: 'dashboard', views: [['dashboard', 'Synthèse'], ['analytics', 'Analyses']] },
  { id: 'operations', label: 'Opérations', primary: 'transactions', views: [['transactions', 'Toutes les opérations'], ['recurring', 'Paiements réguliers'], ['history', 'Historique']] },
  { id: 'planner', label: 'Planificateur', primary: 'planner', views: [['planner', 'Planificateur 1.0']] },
  { id: 'smart', label: 'Centre intelligent', primary: 'smart', views: [['smart', 'Centre intelligent 1.0']] },
  { id: 'wealth', label: 'Patrimoine', primary: 'savings', views: [['savings', 'Épargne'], ['debts', 'Dettes']] },
  { id: 'settings', label: 'Paramètres', primary: 'settings', views: [['settings', 'Paramètres']] }
].map(space => Object.freeze({ ...space, views: Object.freeze(space.views.map(([view, label]) => Object.freeze({ view, label }))) })));

/** La navigation mobile privilégie la consultation. Les vues avancées restent dans le menu latéral. */
export const MOBILE_TABS = Object.freeze({ dashboard: 'dashboard', operations: 'transactions', settings: 'settings' });

export const ALL_VIEWS = Object.freeze(SPACES.flatMap(space => space.views.map(item => item.view)));

export function spaceOfView(view) {
  return SPACES.find(space => space.views.some(item => item.view === view)) || null;
}

export function primaryViewOf(spaceId) {
  return SPACES.find(space => space.id === spaceId)?.primary || null;
}

/** Les vues avancées n'activent aucune destination de la barre mobile. */
export function mobileTabFor(view) {
  const space = spaceOfView(view);
  return (space && MOBILE_TABS[space.id]) || null;
}

/** Onglets internes à afficher dans une vue ; vide quand l'espace ne regroupe qu'une vue. */
export function tabsForView(view) {
  const space = spaceOfView(view);
  return space && space.views.length > 1 ? space.views : [];
}
