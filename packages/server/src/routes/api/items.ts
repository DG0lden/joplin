import { Item, Uuid } from '../../db';
import { formParse } from '../../utils/requestUtils';
import { respondWithItemContent, SubPath } from '../../utils/routeUtils';
import Router from '../../utils/Router';
import { AppContext } from '../../utils/types';
import * as fs from 'fs-extra';
import { ErrorMethodNotAllowed, ErrorNotFound } from '../../utils/errors';
import ItemModel from '../../models/ItemModel';
import { requestChangePagination, requestPagination } from '../../models/utils/pagination';

const router = new Router();

// Note about access control:
//
// - All these calls are scoped to a user, which is derived from the session
// - All items are accessed by userId/itemName
// - In other words, it is not possible for a user to access another user's
//   items, thus the lack of checkIfAllowed() calls as that would not be
//   necessary, and would be slower.

async function itemFromPath(userId: Uuid, itemModel: ItemModel, path: SubPath, mustExists: boolean = true): Promise<Item> {
	const name = itemModel.pathToName(path.id);
	const item = await itemModel.loadByName(userId, name);
	if (mustExists && !item) throw new ErrorNotFound(`Not found: ${path.id}`);
	return item;
}

router.get('api/items/:id', async (path: SubPath, ctx: AppContext) => {
	const itemModel = ctx.models.item();
	const item = await itemFromPath(ctx.owner.id, itemModel, path);
	return itemModel.toApiOutput(item);
});

router.del('api/items/:id', async (path: SubPath, ctx: AppContext) => {
	const itemModel = ctx.models.item();

	try {
		if (path.id === 'root' || path.id === 'root:/:') {
			// We use this for testing only and for safety reasons it's probably
			// best to disable it on production.
			if (ctx.env !== 'dev') throw new ErrorMethodNotAllowed('Deleting the root is not allowed');
			await itemModel.deleteAll(ctx.owner.id);
		} else {
			const item = await itemFromPath(ctx.owner.id, itemModel, path);
			await itemModel.delete(item.id);
		}
	} catch (error) {
		if (error instanceof ErrorNotFound) {
			// That's ok - a no-op
		} else {
			throw error;
		}
	}
});

router.get('api/items/:id/content', async (path: SubPath, ctx: AppContext) => {
	const itemModel = ctx.models.item();
	const item = await itemFromPath(ctx.owner.id, itemModel, path);
	const serializedContent = await itemModel.serializedContent(item.id);
	return respondWithItemContent(ctx.response, item, serializedContent);
});

router.put('api/items/:id/content', async (path: SubPath, ctx: AppContext) => {
	const itemModel = ctx.models.item();
	const name = itemModel.pathToName(path.id);
	const parsedBody = await formParse(ctx.req);
	const buffer = parsedBody?.files?.file ? await fs.readFile(parsedBody.files.file.path) : Buffer.alloc(0);
	const item = await itemModel.saveFromRawContent(ctx.owner.id, name, buffer);
	return itemModel.toApiOutput(item);
});

router.get('api/items/:id/delta', async (_path: SubPath, ctx: AppContext) => {
	const changeModel = ctx.models.change();
	return changeModel.allForUser(ctx.owner.id, requestChangePagination(ctx.query));
});

router.get('api/items/:id/children', async (path: SubPath, ctx: AppContext) => {
	const itemModel = ctx.models.item();
	const parentName = itemModel.pathToName(path.id);
	const result = await itemModel.children(ctx.owner.id, parentName, requestPagination(ctx.query));
	return result;
});

export default router;
