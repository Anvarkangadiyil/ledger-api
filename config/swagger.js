import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { PORT } from "./env.js";

const port = PORT || 5000;

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Ledger API",
      version: "1.0.0",
      description: "API documentation for the Ledger application",
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: "Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["success", "error"],
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            error: {
              type: "string",
              description: "Human-readable error message.",
              example: "Invalid request",
            },
          },
        },
        Account: {
          type: "object",
          required: ["id", "name", "balance", "created_at"],
          properties: {
            id: {
              type: "string",
              description: "Public account identifier.",
              example: "665f1c2a9b1e8a0012a4d3f1",
            },
            name: {
              type: "string",
              description: "Account holder name.",
              example: "Ada Lovelace",
            },
            balance: {
              type: "number",
              description:
                "Current balance in major currency units with two decimal places. New accounts always start at 0.",
              example: 0,
            },
            created_at: {
              type: "string",
              format: "date-time",
              description: "Server-generated account creation timestamp (UTC).",
              example: "2026-10-27T10:00:00.000Z",
            },
          },
        },
      },
    },
  },
  apis: ["./routes/*.js", "./routes/**/*.js", "./app.js"],
};

const swaggerSpec = swaggerJSDoc(options);

const setupSwagger = (app) => {
  // Swagger UI page
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Swagger specification JSON
  app.get("/api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
};

export { swaggerSpec, setupSwagger };
export default setupSwagger;
