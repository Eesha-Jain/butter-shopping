/**
 * Visa Merchant Offers (VMORC) proxy helpers.
 * Live sandbox needs mTLS certs; without them we serve grocery-shaped demo offers
 * with the same response shape so the app and Visa track demo still work.
 */

/** @typedef {{
 *   merchantName: string,
 *   chainKeys: string[],
 *   title: string,
 *   shortDescription: string,
 *   rewardType: 'percent' | 'fixed',
 *   rewardBps?: number,
 *   rewardCents?: number,
 *   validThrough: string | null,
 *   source: 'visa_sandbox' | 'demo',
 * }} VisaOffer
 */

/** @type {VisaOffer[]} */
const DEMO_OFFERS = [
  {
    merchantName: 'Safeway',
    chainKeys: ['safeway'],
    title: '5% back at Safeway',
    shortDescription: 'Visa card-linked offer - grocery',
    rewardType: 'percent',
    rewardBps: 500,
    validThrough: null,
    source: 'demo',
  },
  {
    merchantName: 'QFC',
    chainKeys: ['qfc'],
    title: '$3 off QFC groceries',
    shortDescription: 'Visa merchant offer - statement credit style',
    rewardType: 'fixed',
    rewardCents: 300,
    validThrough: null,
    source: 'demo',
  },
  {
    merchantName: "Trader Joe's",
    chainKeys: ['trader joe', "trader joe's", 'traderjoes'],
    title: "2% back at Trader Joe's",
    shortDescription: 'Visa Offers Network sample - grocery',
    rewardType: 'percent',
    rewardBps: 200,
    validThrough: null,
    source: 'demo',
  },
];

function normalizeMerchant(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '');
}

/**
 * @param {string | null | undefined} merchantFilter
 * @returns {VisaOffer[]}
 */
export function listDemoVisaOffers(merchantFilter) {
  const needle = normalizeMerchant(merchantFilter);
  if (!needle) return DEMO_OFFERS;
  return DEMO_OFFERS.filter((offer) => {
    const name = normalizeMerchant(offer.merchantName);
    return (
      name.includes(needle) ||
      needle.includes(name) ||
      offer.chainKeys.some((key) => needle.includes(key) || key.includes(needle))
    );
  });
}

/**
 * Fuzzy-match an offer to a store/chain display name.
 * @param {VisaOffer} offer
 * @param {string | null | undefined} chainOrStoreName
 */
export function offerMatchesChain(offer, chainOrStoreName) {
  const hay = normalizeMerchant(chainOrStoreName);
  if (!hay) return false;
  const merchant = normalizeMerchant(offer.merchantName);
  if (hay.includes(merchant) || merchant.includes(hay)) return true;
  return offer.chainKeys.some((key) => hay.includes(key));
}

/**
 * Attempt live VMORC when credentials + cert paths are configured.
 * Returns null to signal fall back to demo.
 * @param {string | null | undefined} merchantFilter
 * @returns {Promise<VisaOffer[] | null>}
 */
export async function fetchVisaSandboxOffers(merchantFilter) {
  const userId = process.env.VISA_USER_ID;
  const password = process.env.VISA_PASSWORD;
  const certPath = process.env.VISA_CERT_PATH;
  const keyPath = process.env.VISA_KEY_PATH;
  if (!userId || !password || !certPath || !keyPath) {
    return null;
  }

  try {
    const fs = await import('fs');
    const https = await import('https');
    const auth = Buffer.from(`${userId}:${password}`).toString('base64');
    const params = new URLSearchParams({
      language: 'en-us',
      start_index: '0',
      max_offers: '25',
    });
    if (merchantFilter) params.set('merchant', String(merchantFilter));

    const body = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'sandbox.api.visa.com',
          path: `/vmorc/offers/v1/all?${params.toString()}`,
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Basic ${auth}`,
          },
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
          rejectUnauthorized: true,
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`VMORC ${res.statusCode}: ${raw.slice(0, 200)}`));
              return;
            }
            try {
              resolve(JSON.parse(raw));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

    const rows = Array.isArray(body?.Offers) ? body.Offers : Array.isArray(body) ? body : [];
    if (rows.length === 0) return null;

    return rows.map((row) => {
      const merchantName =
        row.merchantName ?? row.MerchantName ?? row.merchant ?? 'Visa merchant';
      return {
        merchantName: String(merchantName),
        chainKeys: [normalizeMerchant(merchantName)],
        title: String(row.offerTitle ?? row.OfferTitle ?? row.title ?? 'Visa offer'),
        shortDescription: String(
          row.offerShortDescription ?? row.shortDescription ?? row.description ?? '',
        ),
        rewardType: 'percent',
        rewardBps: 200,
        validThrough: row.validTo ?? row.ValidTo ?? null,
        source: 'visa_sandbox',
      };
    });
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} merchantFilter
 */
export async function listVisaOffers(merchantFilter) {
  const live = await fetchVisaSandboxOffers(merchantFilter);
  if (live && live.length > 0) {
    return { offers: live, source: 'visa_sandbox' };
  }
  return { offers: listDemoVisaOffers(merchantFilter), source: 'demo' };
}
