// Les bibliothèques lourdes sont chargées uniquement quand l'utilisateur en a besoin.
const vendorPromises = new Map();

function loadVendor(name, url, isReady) {
  if (isReady()) return Promise.resolve();
  if (vendorPromises.has(name)) return vendorPromises.get(name);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error(`Le module ${name} met trop de temps à répondre.`));
    }, 8_000);

    script.src = url;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      window.clearTimeout(timeout);
      isReady() ? resolve() : reject(new Error(`Le module ${name} est incomplet.`));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error(`Impossible de charger le module ${name}.`));
    };
    document.head.appendChild(script);
  }).catch(error => {
    vendorPromises.delete(name);
    throw error;
  });

  vendorPromises.set(name, promise);
  return promise;
}

function ensureXLSX() {
  return loadVendor(
    'Excel',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    () => Boolean(window.XLSX?.utils)
  );
}

function ensureChartJS() {
  return loadVendor(
    'Graphiques',
    'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
    () => Boolean(window.Chart?.defaults)
  );
}
