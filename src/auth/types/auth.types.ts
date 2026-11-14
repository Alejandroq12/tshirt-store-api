export interface UserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'manager' | 'client';
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: UserResponse;
}

export interface AccessTokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
}
