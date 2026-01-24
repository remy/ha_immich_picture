const key = 'sk_6069_17248_0f56b819f0c0fd92f76923af5b6f84a0';

export async function run(req, res) {
  const request = await fetch(
    'https://api.tickettailor.com/v1/event_series/es_1060395',
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      },
    }
  ).then((response) => response.json());

  return request.default_ticket_types[0].quantity;
}
