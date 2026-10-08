import { handlePublicSignup } from '../lib/homeowner-profile.js';

export default {
  async fetch(request) {
    return handlePublicSignup(request);
  }
};
