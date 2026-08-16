const axios = require('axios');
const CircuitBreaker = require('opossum');

const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || 'http://localhost:8000';

// Configurable via env so tests can use fast/small values instead of
// waiting for real timeouts and reset windows.
const options = {
  timeout: Number(process.env.CIRCUIT_BREAKER_TIMEOUT_MS || 3000),
  errorThresholdPercentage: Number(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD || 50),
  resetTimeout: Number(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || 10000),
  // Minimum number of calls in the rolling window before the breaker will
  // even evaluate the error percentage - prevents tripping on a single
  // unlucky failure when traffic is low.
  volumeThreshold: Number(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || 5),
  // Opossum evaluates failure % over a rolling window split into buckets,
  // re-evaluated as buckets rotate. Defaults (10s window / 10 buckets) are
  // fine for production but far too slow for tests - overridable here.
  rollingCountTimeout: Number(process.env.CIRCUIT_BREAKER_ROLLING_WINDOW_MS || 10000),
  rollingCountBuckets: Number(process.env.CIRCUIT_BREAKER_ROLLING_BUCKETS || 10),
};

// Raw call to Course Service. A 404 here means "course doesn't exist" -
// that's a normal business outcome, NOT a service failure, so we catch it
// and return a value instead of letting it propagate as an error. Only
// network errors, timeouts, and 5xx responses should count as failures
// that the circuit breaker tracks.
async function checkCourseExistsRaw(courseId) {
  try {
    const response = await axios.get(`${COURSE_SERVICE_URL}/api/courses/${courseId}/exists`);
    return response.data; // { exists: true, title }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return { exists: false };
    }
    throw err; // network error, timeout, 5xx - this SHOULD count as a failure
  }
}

const breaker = new CircuitBreaker(checkCourseExistsRaw, options);

breaker.fallback(() => {
  throw new Error('course service call failed or circuit is open');
});

breaker.on('open', () => {
  console.warn('[enrollment-service] circuit breaker OPEN - Course Service calls will fail fast');
});
breaker.on('halfOpen', () => {
  console.warn('[enrollment-service] circuit breaker HALF-OPEN - testing Course Service recovery');
});
breaker.on('close', () => {
  console.log('[enrollment-service] circuit breaker CLOSED - Course Service calls resuming normally');
});

// checkCourseExists(courseId) -> { exists, title? }
// Throws with .circuitOpen = true if the breaker is currently open.
// Throws a normal error (with .response if applicable) for other failures.
function checkCourseExists(courseId) {
  return breaker.fire(courseId);
}

module.exports = { checkCourseExists, breaker };