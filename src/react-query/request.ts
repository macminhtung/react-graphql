import { Variables, RequestOptions, ClientError, gql, GraphQLClient } from 'graphql-request';
import {
  showToastError,
  manageAccessToken,
  EManageTokenType,
  clearTokensAndNavigateSignInPage,
} from '@/common/funcs';
import type {
  RefreshAccessTokenMutation,
  RefreshAccessTokenMutationVariables,
} from '@/gql/graphql';

// #====================#
// # ==> JWT ERRORS <== #
// #====================#
const JWT_ERRORS = {
  EXPIRED: 'jwt expired',
  INVALID_TOKEN: 'invalid token',
  INVALID_SIGNATURE: 'invalid signature',
  UNEXPECTED_TOKEN: 'Unexpected token',
  ACCESS_TOKEN_INVALID: 'Access token invalid',
  REFRESH_TOKEN_INVALID: 'Refresh token invalid',
};

// #==============================#
// # ==> CHECK JWT IS INVALID <== #
// #==============================#
const isJwtInvalid = (errorMessage: string) =>
  [
    JWT_ERRORS.INVALID_TOKEN,
    JWT_ERRORS.INVALID_SIGNATURE,
    JWT_ERRORS.UNEXPECTED_TOKEN,
    JWT_ERRORS.ACCESS_TOKEN_INVALID,
    JWT_ERRORS.REFRESH_TOKEN_INVALID,
  ].includes(errorMessage);

// #===============================#
// # ==> PROCESS REQUEST ERROR <== #
// #===============================#
const processRequestError = (error: ClientError) => {
  const errorMessage = error.response.errors?.[0]?.message || '';

  // CASE: JWT INVALID ==> SIGNOUT
  if (isJwtInvalid(errorMessage))
    showToastError(error, {
      duration: 1500,
      onAutoClose: () => clearTokensAndNavigateSignInPage(),
    });

  // CASE: SHOW MESSAGE ERROR
  showToastError(error);
};

// #================================#
// # ==> REFRESH TOKEN DOCUMENT <== #
// #================================#
const refreshTokenDocument = gql`
  mutation RefreshAccessToken($payload: RefreshAccessTokenDto!) {
    refreshAccessToken(payload: $payload) {
      accessToken
    }
  }
`;

// #===============================#
// # ==> CREATE GRAPHQL CLIENT <== #
// #===============================#
const createClient = (token?: string) =>
  new GraphQLClient(`${import.meta.env.VITE_APP_API}/graphql`, {
    credentials: 'include',
    mode: 'cors',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

// #==============================#
// # ==> REFRESH ACCESS TOKEN <== #
// #==============================#
let refreshPromise: Promise<string> | null = null;

const refreshAccessToken = (accessToken: string): Promise<string> => {
  if (!refreshPromise) {
    const client = createClient();
    refreshPromise = client
      .request<RefreshAccessTokenMutation, RefreshAccessTokenMutationVariables>({
        document: refreshTokenDocument,
        variables: { payload: { accessToken } },
      })
      .then(({ refreshAccessToken }) => {
        const newToken = refreshAccessToken.accessToken;
        manageAccessToken({ type: EManageTokenType.SET, accessToken: newToken });
        refreshPromise = null;
        return newToken;
      })
      .catch((err) => {
        refreshPromise = null;
        return Promise.reject(err);
      });
  }
  return refreshPromise;
};

// #=========================#
// # ==> GRAPHQL REQUEST <== #
// #=========================#
export const request = <R, V extends Variables = Variables>(
  options: RequestOptions<V, R>
): Promise<R> => {
  const accessToken = manageAccessToken({ type: EManageTokenType.GET });
  const client = createClient(accessToken);

  return client.request<R, V>(options).catch((error: ClientError) => {
    const errorMessage = error.response.errors?.[0]?.message || '';

    // CASE: TOKEN EXPIRED
    if (errorMessage === JWT_ERRORS.EXPIRED) {
      return refreshAccessToken(accessToken) // ==> REFRESH ACCESS TOKEN
        .then((newAccessToken) => {
          const newClient = createClient(newAccessToken); // ==> RECALL REQUEST
          return newClient.request<R, V>(options);
        })
        .catch((refreshError) => {
          processRequestError(refreshError); // ==> PROCESS REQUEST ERROR
          return Promise.reject(refreshError);
        });
    }

    // CASE: PROCESS REQUEST ERROR
    processRequestError(error);
    return Promise.reject(error);
  });
};
