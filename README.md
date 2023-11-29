# Server

This is a Node.js based Google Cloud Functions project.

## Setup

1. Install dependencies

```bash
npm install
```

2. Deploy the function to Google Cloud

```bash
gcloud functions deploy YOUR_FUNCTION_NAME --runtime nodejs14 --trigger-http --allow-unauthenticated
```

Replace `YOUR_FUNCTION_NAME` with the name of the function you want to deploy.

## Functions

The functions are defined in the `functions/index.js` file. Each function is an export that responds to HTTP requests or Cloud Events.

## Testing

Tests are defined in the `test/index.test.js` file. To run the tests, use the following command:

```bash
npm test
```

## Linting

This project uses ESLint for linting. The configuration is in the `.eslintrc.json` file. To run the linter, use the following command:

```bash
npm run lint
```

## Contributing

Please read the CONTRIBUTING.md for details on our code of conduct, and the process for submitting pull requests to us.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.