import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { vus: 5, duration: '15s' };
export default function () { const r = http.get(`${__ENV.BASE_URL}/checkout`); check(r, { 'status is 200': x => x.status === 200 }); sleep(0.2); }

