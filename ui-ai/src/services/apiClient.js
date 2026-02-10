import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000
});

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  backoffMultiplier: 2,
  initialDelayMs: 100,
  transientErrorCodes: [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNRESET',
    'ERR_NETWORK'
  ],
  transientStatuses: [408, 429, 500, 502, 503, 504]
};

// Determine if error is transient
function isTransientError(error) {
  if (error.code && RETRY_CONFIG.transientErrorCodes.includes(error.code)) {
    return true;
  }
  if (error.response?.status && RETRY_CONFIG.transientStatuses.includes(error.response.status)) {
    return true;
  }
  if (error.message?.includes('MVCC_READ_CONFLICT')) {
    return true;
  }
  if (error.message?.includes('read/write set conflict')) {
    return true;
  }
  return false;
}

// Sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry wrapper
async function withRetry(asyncFn, operationName = 'API call') {
  let lastError;
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await asyncFn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === RETRY_CONFIG.maxRetries - 1;
      
      if (isTransientError(error) && !isLastAttempt) {
        const backoffDelay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
        console.warn(
          `[RETRY] ${operationName} - Attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries} failed. ` +
          `Error: ${error.message}. Retrying in ${backoffDelay}ms...`
        );
        await sleep(backoffDelay);
        continue;
      }
      
      // If not transient or last attempt, throw
      throw error;
    }
  }
  
  throw lastError;
}

// Attach auth token automatically if present
client.interceptors.request.use(config => {
  try {
    const token = window?.localStorage?.getItem('authToken');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // ignore token retrieval errors
  }
  return config;
});

client.interceptors.response.use(
  response => response,
  error => {
    console.warn('API fallback triggered:', error?.message);
    throw error;
  }
);

export async function safeGet(url, optionsOrFallback = [], fallbackIfOptions) {
  const isOptionsObject = optionsOrFallback && typeof optionsOrFallback === 'object' && !Array.isArray(optionsOrFallback);
  const options = isOptionsObject ? optionsOrFallback : undefined;
  const fallback = isOptionsObject ? (fallbackIfOptions !== undefined ? fallbackIfOptions : []) : optionsOrFallback;
  const shouldThrowError = isOptionsObject && optionsOrFallback.throwError === true;

  try {
    const { data } = await withRetry(
      () => client.get(url, options),
      `GET ${url}`
    );
    return data;
  } catch (error) {
    console.error(`Failed to GET ${url}:`, error.message);
    if (shouldThrowError) {
      throw error;
    }
    return fallback;
  }
}

export async function safePost(url, payload, optionsOrFallback = {}, fallbackIfOptions) {
  const isOptionsObject = optionsOrFallback && typeof optionsOrFallback === 'object' && !Array.isArray(optionsOrFallback);
  const options = isOptionsObject ? optionsOrFallback : undefined;
  const fallback = isOptionsObject ? (fallbackIfOptions !== undefined ? fallbackIfOptions : {}) : optionsOrFallback;
  const shouldThrowError = isOptionsObject && optionsOrFallback.throwError === true;

  try {
    const { data } = await withRetry(
      () => client.post(url, payload, options),
      `POST ${url}`
    );
    return data;
  } catch (error) {
    console.error(`Failed to POST ${url}:`, error.message);
    if (shouldThrowError) {
      throw error;
    }
    return fallback;
  }
}

export default client;

