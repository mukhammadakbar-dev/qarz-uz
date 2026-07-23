import { AppError } from '../utils/errors.js';

export const notFoundHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint topilmadi' } });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  // Postgres unique violation -> 409
  if (err.code === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Bunday yozuv allaqachon mavjud' },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }

  console.error('[error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Serverda xatolik yuz berdi' },
  });
};
