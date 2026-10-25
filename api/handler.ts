import {handleVercel} from '../hosted/vercel-handler.js';
export default {fetch: (request:Request)=>handleVercel(request)};
