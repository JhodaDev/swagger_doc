// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const acorn = require('acorn');
const walk = require('acorn-walk');
const Provider = require('./src/Provider');
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('Congratulations, your extension "swaggerdoc" is now active!');
}

vscode.commands.registerCommand('swaggerdoc.generateDoc', async function () {
  // hacer unas preguntas antes de analizar el codigo como el metodo de la funcion la ruta y dempas
  const endpoint = await getInput('Ingrese la ruta del endpoint (ejemplo: /api/v1/endpoint)')
  const method = await getInput('Ingrese el metodo del endpoint (ejemplo: GET, POST, PUT, DELETE)')
  const tag = await getInput('Ingrese el tag del endpoint (ejemplo: User, Auth, etc)')
  const description = await getInput('Ingrese la descripcion del endpoint (ejemplo: Crea un nuevo usuario)')

  const editor = vscode.window.activeTextEditor;

  if (editor && !editor.selection.isEmpty) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    // Analiza el código fuente seleccionado con acorn
    const ast = acorn.parse(selectedText, {
      sourceType: 'module',
      ecmaVersion: 2020,
    });
    const body = [];
    const statusCode = [];
    const params = [];
    const queryParams = [];

    function extractInfo(node) {
      try {
        if (node.type === 'VariableDeclaration') {
          node.declarations.forEach((declaration) => {
            const value = declaration;
            let isBody = value.init && value.init.type === 'MemberExpression' && value.init.object.name === 'req' && value.init.property.name === 'body';
            if (isBody) {
              const properties = value.id.type === 'ObjectPattern' ? value.id.properties : value.id;
              for (const property of properties) {
                if (!body.includes(property.key.name)) {
                  body.push(property.key.name);
                }
              }
            }

            isBody = value.init && value?.init?.type === 'MemberExpression' && value.init.object.object.name === 'req' && value.init.object.property.name === 'body';
            if (isBody) body.push(value.init.property.name);

            const isQueryParams = value.init && value.init.type === 'MemberExpression' && value.init.object.name === 'req' && value.init.property.name === 'query';
            if (isQueryParams) {
              const properties = value.id.type === 'ObjectPattern' ? value.id.properties : value.id;
              for (const property of properties) {
                if (!queryParams.includes(property.key.name)) queryParams.push(property.key.name);
              }
            }

            if (value.init && value.init.properties) {
              const properties = value.init.properties;
              for (const propertie of properties) {
                if (propertie.value) {
                  const consequent = propertie.value.consequent;
                  if (consequent && consequent.arguments) {
                    for (const argument of consequent.arguments) {
                      const property = argument.object.property;
                      if (property.name === 'query' && !queryParams.includes(argument.property.name)) {
                        queryParams.push(argument.property.name);
                      }
                    }
                  }
                }
              }
            }
          });
        } else if (node.type === 'IfStatement') {
          const consequent = node.consequent;
          if (consequent.type === 'ExpressionStatement') {
            const expression = consequent.expression;
            const rightArguments = expression.right;
            if (rightArguments && rightArguments.type === 'MemberExpression') {
              const isQuery = rightArguments.object.property.name === 'query';
              if (isQuery && !queryParams.includes(rightArguments.property.name)) {
                queryParams.push(rightArguments.property.name);
              }
            }

            if (rightArguments && rightArguments.type === 'ChainExpression') {
              const isQuery = rightArguments.expression.object.property.name === 'query';
              if (isQuery && !queryParams.includes(rightArguments.expression.property.name)) {
                queryParams.push(rightArguments.expression.property.name);
              }
            }
          }
          if (node.alternate) {
            const bodyAlt = node.alternate.body;

            for (const node of bodyAlt) {
              const rightArguments = node.expression?.right;
              if (rightArguments) {
                const isQuery = rightArguments.object.property.name === 'query';
                if (isQuery && !queryParams.includes(rightArguments.property.name)) {
                  queryParams.push(rightArguments.property.name);
                }

                const isBody = rightArguments.object.property.name === 'body';
                if (isBody && !body.includes(rightArguments.property.name)) {
                  body.push(rightArguments.property.name);
                }
              }
            }
          }
        } else if (node.type === 'ReturnStatement') {
          if (node.argument && node.argument.type === 'ObjectExpression') {
            const properties = node.argument.properties;
            for (const property of properties) {
              if (property.key.name === 'code') {
                if (!statusCode.includes(property.value.value)) {
                  statusCode.push(property.value.value);
                }
              }
            }
          }
        }
      } catch (e) {
        console.log(e);
      }
    }

    walk.simple(ast, {
      VariableDeclaration: extractInfo,
      IfStatement: extractInfo,
      ReturnStatement: extractInfo,
    });

    const doc = generateSwaggerDocumentation(endpoint, method, tag, description, body, queryParams, statusCode);

    // mostrar una previsualizacion del doc
    const docPreview = vscode.window.showTextDocument(vscode.Uri.parse('untitled:' + 'newDoc.js'), {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
    });

    docPreview.then((editor) => {
      editor.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 0), doc);
      });
    });
  }
});


const getInput = async (placeholder) => {
  const input = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: placeholder,
  });
  return input
}

function generateSwaggerDocumentation(endpoint, method, tag, description, body, queryParams, statusCode) {
  let doc = `
/**
 * @swagger
 *  ${endpoint}:
 *  ${method}:
 *    summary: ${description}
 *    tags:
 *      - ${tag}
 *    security:
 *      - ApiKeyAuth: []
`;

  if (method.toLowerCase() === 'post' && body.length > 0) {
    doc += `
 *    requestBody:
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            properties:
`;

    body.forEach((param) => {
      doc += `
 *              ${param}:
 *                type: string
 *                example: example_value_for_${param}
`;
    });

    doc += `
 *            required:
`;

    body.forEach((param) => {
      doc += `
 *              - ${param}
`;
    });
  }

  if (queryParams.length > 0) {
    doc += `
 *    parameters:
`;

    queryParams.forEach((param) => {
      doc += `
 *      - name: ${param}
 *        in: query
 *        schema:
 *          type: string
`;
    });
  }

  doc += `
 *    responses:
`;

  statusCode.forEach((code) => {
    doc += `
 *      ${code}:
 *        description: description_for_status_${code}
`;
  });

  doc += ` */`;

  // Eliminar líneas vacías
  doc = doc.replace(/^\s*[\r\n]/gm, '');

  return doc;
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
