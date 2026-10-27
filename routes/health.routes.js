import { Router } from "express";

const healthRouter = Router();

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     summary: API health check
 *     description: Returns the status and uptime of the Ledger API service
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is running successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 uptime:
 *                   type: number
 *                   example: 15.2
 *                 timestamp:
 *                   type: string
 *                   example: 2026-10-27T10:00:00.000Z
 */
healthRouter.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
