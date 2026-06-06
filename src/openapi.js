export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Hintro Meeting Intelligence Service',
      version: '1.0.0',
      description: 'Backend API for meeting intelligence, action items, analysis, and reminders.',
    },
    servers: [{ url: 'http://localhost:3000' }],
    paths: {
      '/health': { get: { summary: 'Health check', responses: { 200: { description: 'OK' } } } },
      '/api/auth/login': {
        post: {
          summary: 'Login',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] },
              },
            },
          },
          responses: { 200: { description: 'Token' } },
        },
      },
      '/api/meetings': {
        get: { summary: 'List meetings', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Meetings' } } },
        post: { summary: 'Create meeting', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Created' } } },
      },
      '/api/meetings/{id}': {
        get: { summary: 'Get meeting', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Meeting' } } },
        delete: { summary: 'Delete meeting', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Deleted' } } }
      },
      '/api/meetings/{id}/analyze': { post: { summary: 'Analyze meeting', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Analysis' } } } },
      '/api/action-items': {
        get: { summary: 'List action items', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Action items' } } },
        post: { summary: 'Create action item', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Created' } } },
      },
      '/api/action-items/{id}/status': {
        patch: { summary: 'Update action item status', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Updated' } } },
      },
      '/api/action-items/overdue': {
        get: { summary: 'List overdue action items', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Overdue action items' } } },
      },
      '/api/evaluation': { get: { summary: 'Evaluation payload', responses: { 200: { description: 'Evaluation info' } } } },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
}
