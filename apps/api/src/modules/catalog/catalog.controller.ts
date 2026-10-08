import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { categorySchema, productQuerySchema, productSchema, supplierSchema, updateProductSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { Operational, Perm } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @Perm('product:view')
  @Doc('Catálogo (busca por nome, SKU, código de barras, compatibilidade)', { query: productQuerySchema })
  list(@ZQuery(productQuerySchema) q: z.infer<typeof productQuerySchema>) {
    return this.catalog.listProducts(q);
  }

  @Post('products')
  @Perm('product:edit')
  @Operational()
  @Doc('Cadastra produto/peça/serviço', { body: productSchema })
  create(@ZBody(productSchema) body: z.infer<typeof productSchema>) {
    return this.catalog.createProduct(body);
  }

  @Get('products/:id')
  @Perm('product:view')
  @Doc('Detalhe do produto com saldos')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProduct(id);
  }

  @Patch('products/:id')
  @Perm('product:edit')
  @Operational()
  @Doc('Atualiza produto', { body: updateProductSchema })
  update(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateProductSchema) body: z.infer<typeof updateProductSchema>) {
    return this.catalog.updateProduct(id, body);
  }

  @Get('categories')
  @Perm('product:view')
  @Doc('Categorias')
  categories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @Perm('product:edit')
  @Operational()
  @Doc('Cria categoria', { body: categorySchema })
  createCategory(@ZBody(categorySchema) body: z.infer<typeof categorySchema>) {
    return this.catalog.createCategory(body);
  }

  @Get('suppliers')
  @Perm('product:view')
  @Doc('Fornecedores')
  suppliers() {
    return this.catalog.listSuppliers();
  }

  @Post('suppliers')
  @Perm('product:edit')
  @Operational()
  @Doc('Cria fornecedor', { body: supplierSchema })
  createSupplier(@ZBody(supplierSchema) body: z.infer<typeof supplierSchema>) {
    return this.catalog.createSupplier(body);
  }
}
