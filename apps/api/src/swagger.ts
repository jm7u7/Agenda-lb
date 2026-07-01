import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Limablue Agenda API',
      version: '1.0.0',
      description: 'API REST para el sistema de agendamiento de citas de Limablue — Clínica de Salud del Pie',
      contact: { name: 'Limablue', email: 'tech@limablue.pe' },
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Desarrollo' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT para usuarios del sistema',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'API Key en formato: ApiKey <tu_api_key>',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Autenticación y tokens' },
      { name: 'Citas', description: 'Gestión de citas' },
      { name: 'Disponibilidad', description: 'Consulta de slots disponibles' },
      { name: 'Pacientes', description: 'Ficha y búsqueda de pacientes' },
      { name: 'Profesionales', description: 'Profesionales y sus horarios' },
      { name: 'Sedes', description: 'Sedes y configuración' },
      { name: 'Servicios', description: 'Catálogo de servicios' },
      { name: 'Competencias', description: 'Matriz de competencias' },
      { name: 'Asignaciones', description: 'Rotación de profesionales entre sedes' },
      { name: 'Paquetes', description: 'Paquetes de sesiones' },
      { name: 'Auditoría', description: 'Log de cambios del sistema' },
      { name: 'Webhooks', description: 'Suscripciones a eventos salientes' },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
