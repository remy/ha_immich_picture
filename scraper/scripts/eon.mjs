import 'renvy';

const endpoint = 'https://api.eonnext-kraken.energy/v1/graphql/';

const LOGIN_MUTATION = `
  mutation loginEmailAuthentication($input: ObtainJSONWebTokenInput!) {
    obtainKrakenToken(input: $input) {
      payload
      refreshExpiresIn
      refreshToken
      token
      __typename
    }
  }
`;

const GET_USER_QUERY = `
  query headerGetLoggedInUser {
    viewer {
      accounts {
        ... on AccountType {
          applications(first: 1) {
            edges {
              node {
                isMigrated
                migrationSource
                __typename
              }
            }
            __typename
          }
          __typename
        }
        balance
        number
        __typename
      }
      __typename
    }
    __typename
  }
`;

const GET_METER_QUERY = `
  query getAccountMeterSelector(
    $accountNumber: String!
    $showInactive: Boolean!
  ) {
    properties(accountNumber: $accountNumber) {
      ...MeterSelectorPropertyFields
      __typename
    }
  }

  fragment MeterSelectorPropertyFields on PropertyType {
    __typename
    electricityMeterPoints {
      ...MeterSelectorElectricityMeterPointFields
      __typename
    }
    gasMeterPoints {
      ...MeterSelectorGasMeterPointFields
      __typename
    }
    id
    postcode
  }

  fragment MeterSelectorElectricityMeterPointFields on ElectricityMeterPointType {
    __typename
    id
    agreements(includeInactive: $showInactive, excludeFuture: true) {
      tariff {
        ... on StandardTariff {
          unitRate
          standingCharge
        }
      }
    }
    meters(includeInactive: $showInactive) {
      ...MeterSelectorElectricityMeterFields
      __typename
    }
  }

  fragment MeterSelectorElectricityMeterFields on ElectricityMeterType {
    __typename
    activeTo
    id
    registers {
      id
      name
      __typename
    }
    serialNumber
  }

  fragment MeterSelectorGasMeterPointFields on GasMeterPointType {
    __typename
    id
    agreements(includeInactive: $showInactive, excludeFuture: true) {
      tariff {
        unitRate
        standingCharge
      }
    }
    meters(includeInactive: $showInactive) {
      ...MeterSelectorGasMeterFields
      __typename
    }
  }

  fragment MeterSelectorGasMeterFields on GasMeterType {
    __typename
    activeTo
    id
    registers {
      id
      name
      __typename
    }
    serialNumber
  }
`;

async function graphqlRequest(query, variables = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `JWT ${token}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return data.data;
}

async function getEonNextData(email, password) {
  try {
    // Step 1: Login
    const loginRes = await graphqlRequest(LOGIN_MUTATION, {
      input: { email, password },
    });

    const token = loginRes.obtainKrakenToken.token;

    // Step 2: Get account number
    const userRes = await graphqlRequest(GET_USER_QUERY, {}, token);
    const accountNumber = userRes.viewer.accounts[0].number;

    // Step 3: Get meter data
    const meterRes = await graphqlRequest(
      GET_METER_QUERY,
      {
        accountNumber,
        showInactive: false,
      },
      token
    );

    const p = meterRes.properties[0];
    const elec = p.electricityMeterPoints[0].agreements[0].tariff;
    const gas = p.gasMeterPoints[0].agreements[0].tariff;

    return {
      electricity: {
        unitRate: elec.unitRate,
        standingCharge: elec.standingCharge,
      },
      gas: {
        unitRate: gas.unitRate,
        standingCharge: gas.standingCharge,
      },
    };
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
}

// Usage
getEonNextData(process.env.EON_U, process.env.EON_P)
  .then((data) => console.log(JSON.stringify(data, null, 2)))
  .catch((err) => console.error(err));
