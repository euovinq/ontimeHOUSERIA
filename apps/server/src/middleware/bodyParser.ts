import express from 'express';

export const bodyParser = [
  express.urlencoded({ limit: '16mb', extended: true }),
  express.json({ limit: '16mb' }),
];
