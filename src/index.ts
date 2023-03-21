import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IDisposable, DisposableDelegate } from '@lumino/disposable';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import {
  INotebookTracker,
  NotebookPanel,
  INotebookModel
} from '@jupyterlab/notebook';
import {
  ICommandPalette,
  ToolbarButton,
  InputDialog,
  Dialog
} from '@jupyterlab/apputils';
import { requestAPI } from './handler';

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { LabIcon } from '@jupyterlab/ui-components';

import gptIconSvgStr from '../style/icons/ai.svg';

export {
  runIcon as continueIcon,
  stopIcon as terminateIcon
} from '@jupyterlab/ui-components';

export const gptIcon = new LabIcon({
  name: 'juno:run_gpt',
  svgstr: gptIconSvgStr
});

/**
 * Initialization data for the juno extension.
 */
async function loadSetting(setting: ISettingRegistry.ISettings) {
  // Read the settings and convert to the correct type
  let openai_key = setting.get('openai_key').composite as string;
  const text_model = setting.get('text_model').composite as string;
  const max_tokens = setting.get('max_tokens').composite as number;
  const temperature = setting.get('temperature').composite as number;
  const top_p = setting.get('top_p').composite as number;
  const presence_penalty = setting.get('presence_penalty').composite as number;
  const frequency_penalty = setting.get('frequency_penalty')
    .composite as number;
  if (!openai_key) {
    const inputValue: Dialog.IResult<string> = await InputDialog.getText({
      title: 'Provide your OpenAI API Key'
    });
    if (inputValue.value) {
      await setting.set('openai_key', inputValue.value);
      openai_key = inputValue.value;
    }
  }
  return {
    openai_key,
    text_model,
    max_tokens,
    temperature,
    top_p,
    presence_penalty,
    frequency_penalty
  };
}

export class GPTButtonExtension
  implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel>
{
  /**
   * Create a new extension for the notebook panel widget.
   *
   * @param panel Notebook panel
   * @param context Notebook context
   * @returns Disposable on the added button
   */
  app: JupyterFrontEnd;
  constructor(app: JupyterFrontEnd) {
    this.app = app;
  }

  createNew(
    panel: NotebookPanel,
    context: DocumentRegistry.IContext<INotebookModel>
  ): IDisposable {
    const runGPT = () => {
      this.app.commands.execute('@juno/plugin:run_gpt').catch(reason => {
        console.error(
          `An error occurred during the execution of jlab-examples:command.\n${reason}`
        );
      });
    };
    const button = new ToolbarButton({
      className: 'gpt-button',
      label: 'juno',
      onClick: runGPT,
      tooltip: 'juno',
      icon: gptIcon
    });

    panel.toolbar.insertItem(10, 'gpt', button);
    return new DisposableDelegate(() => {
      button.dispose();
    });
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'juno:plugin',
  autoStart: true,
  optional: [ISettingRegistry, INotebookTracker, ICommandPalette],
  activate: async (
    app: JupyterFrontEnd,
    settings: ISettingRegistry | null,
    notebooks: INotebookTracker,
    palette: ICommandPalette
  ) => {
    console.log('JupyterLab extension juno is activated!');
    const { commands } = app;
    app.docRegistry.addWidgetExtension('Notebook', new GPTButtonExtension(app));
    if (settings) {
      Promise.all([app.restored, settings.load('juno:plugin')])
        .then(([, setting]) => {
          setting.changed.connect(loadSetting);

          commands.addCommand('@juno/plugin:run_gpt', {
            label: 'Juno AI',
            execute: async () => {
              if (notebooks) {
                const {
                  openai_key,
                  text_model,
                  max_tokens,
                  temperature,
                  top_p,
                  presence_penalty,
                  frequency_penalty
                } = await loadSetting(setting);
                const activeCell = notebooks.activeCell;
                if (activeCell) {
                  activeCell.setPrompt('…');
                  const dataToSend = {
                    params: {
                      model: text_model,
                      prompt: activeCell.editor.model.value.text,
                      temperature,
                      top_p,
                      max_tokens,
                      presence_penalty,
                      frequency_penalty
                    },
                    openai_key
                  };

                  try {
                    const reply = await requestAPI<any>('complete', {
                      body: JSON.stringify(dataToSend),
                      method: 'POST'
                    });
                    activeCell.editor.model.value.text += reply.choices[0].text;
                  } catch (reason) {
                    console.error(`Error on POST ${dataToSend}.\n${reason}`);
                  }
                  activeCell.setPrompt('');
                }
              }
            }
          });

          palette.addItem({
            command: '@juno/plugin:run_gpt',
            category: 'GPT'
          });
        })
        .catch(reason => {
          console.error(
            `Something went wrong when reading the settings.\n${reason}`
          );
        });
    }
  }
};

export default plugin;
