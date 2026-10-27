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
