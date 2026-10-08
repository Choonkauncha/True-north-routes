import { handleInspection } from '../lib/homeowner-profile.js';

export default {
  async fetch(request) {
    return handleInspection(request);
  }
};
