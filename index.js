import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import tunnel from 'tunnel';
import axios from 'axios';

// Gemini API配置
const GEMINI_API_KEY = 'AIzaSyBaDpioX0_LI_8Mo5HqWjdZtORTgQzI58Y';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=';

// 代理设置
const httpsAgent = tunnel.httpsOverHttp({
  proxy: {
    host: '127.0.0.1',
    port: 7890
  }
});

async function getMangaInfoBatch(items) {
  const prompt = `分析以下漫画名称/文件夹名称列表，为每一项返回中文标准名称和出版社。
严格按照以下JSON格式返回，不要包含markdown格式或其他任何文字：
{
  "results": [
    {
      "original": "原始名称",
      "title": "漫画的中文标准名称",
      "publisher": "出版社名称"
    }
  ]
}

注意事项：
1. 必须使用中文名称，不要使用英文
2. 直接返回JSON，不要包含 \`\`\`json 这样的标记
3. 即使原名是英文，也要返回对应的中文名称

待分析内容:
${JSON.stringify(items, null, 2)}`;

  try {
    const response = await axios({
      method: 'post',
      url: `${GEMINI_API_URL}${GEMINI_API_KEY}`,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      httpsAgent: httpsAgent,
      data: {
        contents: [{
          role: 'user',
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        }
      }
    });

    const text = response.data.candidates[0].content.parts[0].text;
    // 以防万一还是加上清理markdown格式的代码
    const cleanText = text.replace(/```json\n|\n```/g, '').trim();
    console.log('Gemini Response:', cleanText);
    return JSON.parse(cleanText);
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.error('请求超时');
    } else {
      console.error('获取漫画信息失败:', error.response?.data || error.message);
    }
    return null;
  }
}

async function organizeFiles(sourcePath, targetPath) {
  console.log('目标路径:', targetPath);
  await fs.ensureDir(targetPath);
  console.log('源路径:', sourcePath);

  const files = await glob('**/*.{cbz,zip,cbr,pdf,rar,7z}', { cwd: sourcePath });
  console.log('找到的文件:', files);

  const itemsToAnalyze = files.map(file => {
    const dirName = path.dirname(file);
    const fileName = path.basename(file);
    return {
      path: file,
      name: dirName === '.' ? fileName : dirName,
      fullName: file
    };
  });

  console.log('待分析的项目:', JSON.stringify(itemsToAnalyze, null, 2));

  const mangaInfos = await getMangaInfoBatch(itemsToAnalyze);
  console.log('解析结果:', mangaInfos);

  // 修改文件处理逻辑
  if (mangaInfos && mangaInfos.results) {
    for (const info of mangaInfos.results) {
      // 找到对应的原始文件信息，使用完整路径进行匹配
      const items = itemsToAnalyze.filter(i =>
        i.fullName.includes(info.original) ||
        i.name === info.original
      );

      for (const item of items) {
        // 创建新的目录结构
        const publisherPath = path.join(targetPath, info.publisher);
        const seriesPath = path.join(publisherPath, info.title);
        await fs.ensureDir(seriesPath);

        // 创建硬链接
        const sourceFull = path.join(sourcePath, item.path);
        const targetFull = path.join(seriesPath, path.basename(item.path));

        try {
          await fs.ensureLink(sourceFull, targetFull);
          console.log(`已创建硬链接: ${targetFull}`);
        } catch (error) {
          console.error(`创建硬链接失败: ${sourceFull}`, error);
        }
      }
    }
  }
}

// 使用示例
const sourcePath = 'example/input';
const targetPath = 'example/output';

organizeFiles(sourcePath, targetPath).catch(console.error); 